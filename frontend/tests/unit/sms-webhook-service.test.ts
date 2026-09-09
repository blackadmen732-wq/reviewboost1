import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();

vi.mock("@/lib/server/supabase", () => ({
  serviceRoleClient: () => ({ rpc }),
}));

vi.mock("@/lib/server/crypto", () => ({
  encrypt: (value: string | null | undefined) => (value == null ? null : `enc:${value}`),
  keyedDigest: () => "d".repeat(64),
}));

vi.mock("@/lib/server/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

beforeAll(() => {
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
});

const load = () => import("@/lib/server/sms/webhook-service");

function deliveryBody(messageId: string, eventId: string, status = "delivered") {
  return JSON.stringify({ type: "status", messageId, status, eventId });
}

describe("receiveWebhook — receipt-before-SID park", () => {
  it("parks an unmatched terminal receipt and still accepts (HTTP 200 path)", async () => {
    rpc.mockReset();
    rpc.mockImplementation(async (name: string) => {
      if (name === "rpc_sms_webhook_receive") {
        return { data: { inbox_id: "inbox-1", inserted: true }, error: null };
      }
      if (name === "rpc_sms_apply_or_park_delivery_status") {
        return { data: "no_matching_attempt", error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    });

    const { receiveWebhook } = await load();
    const outcome = await receiveWebhook({
      provider: "fake",
      url: "https://app.example.com/api/v1/webhooks/sms/fake",
      headers: { "content-type": "application/json" },
      rawBody: deliveryBody("SM_early", "evt-early"),
    });

    expect(outcome).toEqual({ accepted: true, duplicate: false, action: "delivery_status" });
    expect(rpc).toHaveBeenCalledWith(
      "rpc_sms_apply_or_park_delivery_status",
      expect.objectContaining({
        p_inbox_id: "inbox-1",
        p_provider: "fake",
        p_provider_message_id: "SM_early",
        p_terminal: "delivered",
      }),
    );
    expect(rpc.mock.calls.some(([name]) => name === "rpc_sms_webhook_settle")).toBe(false);
    expect(rpc.mock.calls.some(([name]) => name === "rpc_sms_apply_delivery_status")).toBe(false);
  });

  it("does not re-settle a receipt that applied on first try", async () => {
    rpc.mockReset();
    rpc.mockImplementation(async (name: string) => {
      if (name === "rpc_sms_webhook_receive") {
        return { data: { inbox_id: "inbox-2", inserted: true }, error: null };
      }
      if (name === "rpc_sms_apply_or_park_delivery_status") {
        return { data: "delivered", error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    });

    const { receiveWebhook } = await load();
    const outcome = await receiveWebhook({
      provider: "fake",
      url: "https://app.example.com/api/v1/webhooks/sms/fake",
      headers: { "content-type": "application/json" },
      rawBody: deliveryBody("SM_ready", "evt-ready"),
    });

    expect(outcome).toEqual({ accepted: true, duplicate: false, action: "delivery_status" });
    expect(rpc.mock.calls.some(([name]) => name === "rpc_sms_webhook_settle")).toBe(false);
  });
});
