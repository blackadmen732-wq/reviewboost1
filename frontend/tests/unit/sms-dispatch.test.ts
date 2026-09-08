import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();

vi.mock("@/lib/server/supabase", () => ({
  serviceRoleClient: () => ({ rpc }),
}));

vi.mock("@/lib/server/crypto", () => ({
  decrypt: (value: string | null | undefined) => (value ? value.replace(/^enc:/, "") : null),
}));

vi.mock("@/lib/server/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const send = vi.fn();

vi.mock("@/lib/server/sms/provider", () => ({
  getSmsProvider: () => ({ name: "fake", send }),
}));

beforeAll(() => {
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
});

const load = () => import("@/lib/server/sms/dispatch");

const JOB = {
  id: "job-1",
  org_id: "org-1",
  request_id: "req-1",
  attempts: 1,
};

function beginSending() {
  return {
    outcome: "sending",
    attempt_id: "att-1",
    message_encrypted: "enc:hello",
    phone_encrypted: "enc:+15551230000",
    defer_until: null,
  };
}

describe("dispatchOnce — retryable outbox outcomes", () => {
  it("counts retryable when fail_outbox requeues", async () => {
    rpc.mockReset();
    send.mockReset();
    send.mockResolvedValue({
      outcome: "retryable",
      errorClass: "rate_limited",
      raw: { simulated: "rate_limited" },
    });
    rpc.mockImplementation(async (name: string) => {
      if (name === "rpc_sms_claim_outbox") return { data: [JOB], error: null };
      if (name === "rpc_sms_begin_dispatch") return { data: beginSending(), error: null };
      if (name === "rpc_sms_settle_attempt") return { data: "retryable", error: null };
      if (name === "rpc_sms_fail_outbox") return { data: "pending", error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    });

    const { dispatchOnce } = await load();
    const summary = await dispatchOnce({ worker: "w1", limit: 1 });
    expect(summary).toMatchObject({ claimed: 1, retryable: 1, failed: 0 });
    expect(rpc).toHaveBeenCalledWith(
      "rpc_sms_fail_outbox",
      expect.objectContaining({ p_id: "job-1", p_worker: "w1" }),
    );
  });

  it("counts failed when fail_outbox dead-letters the queued retry", async () => {
    rpc.mockReset();
    send.mockReset();
    send.mockResolvedValue({
      outcome: "retryable",
      errorClass: "rate_limited",
      raw: { simulated: "rate_limited" },
    });
    rpc.mockImplementation(async (name: string) => {
      if (name === "rpc_sms_claim_outbox") return { data: [{ ...JOB, attempts: 8 }], error: null };
      if (name === "rpc_sms_begin_dispatch") return { data: beginSending(), error: null };
      if (name === "rpc_sms_settle_attempt") return { data: "retryable", error: null };
      if (name === "rpc_sms_fail_outbox") return { data: "dead_letter", error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    });

    const { dispatchOnce } = await load();
    const summary = await dispatchOnce({ worker: "w1", limit: 1 });
    expect(summary).toMatchObject({ claimed: 1, retryable: 0, failed: 1 });
    expect(rpc).toHaveBeenCalledWith(
      "rpc_sms_settle_attempt",
      expect.objectContaining({ p_outcome: "retryable", p_attempt_id: "att-1" }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "rpc_sms_fail_outbox",
      expect.objectContaining({ p_id: "job-1" }),
    );
  });
});
