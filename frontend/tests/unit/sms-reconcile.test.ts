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

const lookup = vi.fn();

vi.mock("@/lib/server/sms/provider", () => ({
  getSmsProvider: () => ({ name: "fake", send: vi.fn(), lookup }),
}));

beforeAll(() => {
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
});

const load = () => import("@/lib/server/sms/reconcile");

const JOB = {
  id: "job-r1",
  org_id: "org-1",
  request_id: "req-1",
  attempts: 1,
};

function ready() {
  return {
    outcome: "ready",
    attempt_id: "att-1",
    provider: "fake",
    phone_encrypted: "enc:+15551230000",
    message_encrypted: "enc:hello",
    dispatched_at: "2026-09-08T12:00:00.000Z",
  };
}

describe("reconcileOnce", () => {
  it("attaches a looked-up SID and completes the job (timeout-after-accept)", async () => {
    rpc.mockReset();
    lookup.mockReset();
    lookup.mockResolvedValue({
      outcome: "found",
      providerMessageId: "fake_timeout_sid",
      terminal: "delivered",
      raw: { simulated: "lookup_found" },
    });
    rpc.mockImplementation(async (name: string) => {
      if (name === "rpc_sms_claim_outbox") return { data: [JOB], error: null };
      if (name === "rpc_sms_reconcile_prepare") return { data: ready(), error: null };
      if (name === "rpc_sms_reconcile_attach_sid") return { data: "delivered", error: null };
      if (name === "rpc_sms_complete_outbox") return { data: null, error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    });

    const { reconcileOnce } = await load();
    const summary = await reconcileOnce({ worker: "rw1", limit: 1 });
    expect(summary).toMatchObject({ claimed: 1, applied: 1, attached: 0, released: 0 });
    expect(rpc).toHaveBeenCalledWith(
      "rpc_sms_claim_outbox",
      expect.objectContaining({ p_topic: "sms.reconcile" }),
    );
    expect(lookup).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "req:req-1",
        to: "+15551230000",
        body: "hello",
      }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "rpc_sms_reconcile_attach_sid",
      expect.objectContaining({
        p_attempt_id: "att-1",
        p_provider_message_id: "fake_timeout_sid",
        p_terminal: "delivered",
      }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "rpc_sms_complete_outbox",
      expect.objectContaining({ p_id: "job-r1", p_worker: "rw1" }),
    );
  });

  it("defers a recent not_found so a still-completing accept is not released", async () => {
    rpc.mockReset();
    lookup.mockReset();
    lookup.mockResolvedValue({ outcome: "not_found", raw: { simulated: "not_accepted" } });
    rpc.mockImplementation(async (name: string) => {
      if (name === "rpc_sms_claim_outbox") return { data: [JOB], error: null };
      if (name === "rpc_sms_reconcile_prepare") {
        return { data: { ...ready(), dispatched_at: new Date().toISOString() }, error: null };
      }
      if (name === "rpc_sms_fail_outbox") return { data: "pending", error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    });

    const { reconcileOnce } = await load();
    const summary = await reconcileOnce({ worker: "rw1", limit: 1 });
    expect(summary).toMatchObject({ claimed: 1, deferred: 1, released: 0 });
    expect(rpc.mock.calls.some(([name]) => name === "rpc_sms_reconcile_fail_release")).toBe(false);
  });

  it("fails and releases when the provider confirms no message", async () => {
    rpc.mockReset();
    lookup.mockReset();
    lookup.mockResolvedValue({ outcome: "not_found", raw: { simulated: "not_accepted" } });
    rpc.mockImplementation(async (name: string) => {
      if (name === "rpc_sms_claim_outbox") return { data: [JOB], error: null };
      if (name === "rpc_sms_reconcile_prepare") return { data: ready(), error: null };
      if (name === "rpc_sms_reconcile_fail_release") return { data: "failed", error: null };
      if (name === "rpc_sms_complete_outbox") return { data: null, error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    });

    const { reconcileOnce } = await load();
    const summary = await reconcileOnce({ worker: "rw1", limit: 1 });
    expect(summary).toMatchObject({ claimed: 1, released: 1, attached: 0 });
    expect(rpc).toHaveBeenCalledWith(
      "rpc_sms_reconcile_fail_release",
      expect.objectContaining({ p_request_id: "req-1", p_error: "provider_not_found" }),
    );
    expect(rpc.mock.calls.some(([name]) => name === "rpc_sms_reconcile_attach_sid")).toBe(false);
  });

  it("defers when lookup is still unknown (keeps reservation)", async () => {
    rpc.mockReset();
    lookup.mockReset();
    lookup.mockResolvedValue({
      outcome: "unknown",
      errorClass: "timeout",
      raw: { simulated: "lookup_unknown" },
    });
    rpc.mockImplementation(async (name: string) => {
      if (name === "rpc_sms_claim_outbox") return { data: [JOB], error: null };
      if (name === "rpc_sms_reconcile_prepare") return { data: ready(), error: null };
      if (name === "rpc_sms_fail_outbox") return { data: "pending", error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    });

    const { reconcileOnce } = await load();
    const summary = await reconcileOnce({ worker: "rw1", limit: 1 });
    expect(summary).toMatchObject({ claimed: 1, deferred: 1, released: 0 });
    expect(rpc).toHaveBeenCalledWith(
      "rpc_sms_fail_outbox",
      expect.objectContaining({ p_id: "job-r1", p_worker: "rw1" }),
    );
    expect(rpc.mock.calls.some(([name]) => name === "rpc_sms_complete_outbox")).toBe(false);
  });

  it("defers when the attempt's provider does not match the configured adapter", async () => {
    rpc.mockReset();
    lookup.mockReset();
    rpc.mockImplementation(async (name: string) => {
      if (name === "rpc_sms_claim_outbox") return { data: [JOB], error: null };
      if (name === "rpc_sms_reconcile_prepare") {
        return { data: { ...ready(), provider: "twilio" }, error: null };
      }
      if (name === "rpc_sms_fail_outbox") return { data: "pending", error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    });

    const { reconcileOnce } = await load();
    const summary = await reconcileOnce({ worker: "rw1", limit: 1 });
    expect(summary).toMatchObject({ claimed: 1, deferred: 1, released: 0 });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("skips and completes when the request is already resolved", async () => {
    rpc.mockReset();
    lookup.mockReset();
    rpc.mockImplementation(async (name: string) => {
      if (name === "rpc_sms_claim_outbox") return { data: [JOB], error: null };
      if (name === "rpc_sms_reconcile_prepare") {
        return { data: { outcome: "already_delivered", attempt_id: null }, error: null };
      }
      if (name === "rpc_sms_complete_outbox") return { data: null, error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    });

    const { reconcileOnce } = await load();
    const summary = await reconcileOnce({ worker: "rw1", limit: 1 });
    expect(summary).toMatchObject({ claimed: 1, skipped: 1 });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("counts released when an unknown lookup exhausts the outbox", async () => {
    rpc.mockReset();
    lookup.mockReset();
    lookup.mockResolvedValue({
      outcome: "unknown",
      errorClass: "timeout",
      raw: { simulated: "lookup_unknown" },
    });
    rpc.mockImplementation(async (name: string) => {
      if (name === "rpc_sms_claim_outbox") return { data: [{ ...JOB, attempts: 8 }], error: null };
      if (name === "rpc_sms_reconcile_prepare") return { data: ready(), error: null };
      if (name === "rpc_sms_fail_outbox") return { data: "dead_letter", error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    });

    const { reconcileOnce } = await load();
    const summary = await reconcileOnce({ worker: "rw1", limit: 1 });
    expect(summary).toMatchObject({ claimed: 1, released: 1, deferred: 0 });
  });
});
