import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("google-auth-library", () => ({
  JWT: class {
    async getAccessToken() {
      return { token: "test-google-token" };
    }
  },
}));
import {
  deliveryProviders,
  googleObjectId,
  type DeliveryJob,
} from "@/lib/server/engagement/providers";
import {
  dispatchEngagement,
  engagementWorkerAuthorized,
} from "@/lib/server/engagement/adaptive-service";
import type { SupabaseClient } from "@supabase/supabase-js";

const job: DeliveryJob = {
  id: "11111111-1111-4111-8111-111111111111",
  leaseToken: "22222222-2222-4222-8222-222222222222",
  orgId: "33333333-3333-4333-8333-333333333333",
  memberId: "44444444-4444-4444-8444-444444444444",
  provider: "webhook",
  target: "member-id",
  title: "One visit away",
  body: "Your next purchase counts.",
};
beforeEach(() => {
  vi.stubEnv("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON", "");
  vi.stubEnv("GOOGLE_WALLET_ISSUER_ID", "");
  vi.stubEnv("ENGAGEMENT_DELIVERY_WEBHOOK_URL", "");
  vi.stubEnv("ENGAGEMENT_DELIVERY_WEBHOOK_SECRET", "");
  vi.stubEnv("ENGAGEMENT_WORKER_SECRET", "");
  vi.stubEnv("CRON_SECRET", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function webhook() {
  vi.stubEnv(
    "ENGAGEMENT_DELIVERY_WEBHOOK_URL",
    "https://gateway.example.test/messages",
  );
  vi.stubEnv("ENGAGEMENT_DELIVERY_WEBHOOK_SECRET", "test-secret-".repeat(4));
  return deliveryProviders()[0]!;
}
describe("engagement delivery and receipts", () => {
  it("fails closed without configured providers or a worker secret", async () => {
    expect(deliveryProviders()).toEqual([]);
    expect(
      engagementWorkerAuthorized(new Request("https://example.test")),
    ).toBe(false);
    const db = { rpc: vi.fn() } as unknown as SupabaseClient;
    expect(await dispatchEngagement([], db)).toMatchObject({
      configured: false,
    });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("authenticates exact worker bearer tokens", () => {
    vi.stubEnv("ENGAGEMENT_WORKER_SECRET", "a".repeat(40));
    expect(
      engagementWorkerAuthorized(
        new Request("https://example.test", {
          headers: { Authorization: `Bearer ${"a".repeat(40)}` },
        }),
      ),
    ).toBe(true);
    expect(
      engagementWorkerAuthorized(
        new Request("https://example.test", {
          headers: { Authorization: `Bearer ${"a".repeat(40)} extra` },
        }),
      ),
    ).toBe(false);
  });
  it("records acceptance only when the gateway supplies a receipt", async () => {
    const provider = webhook();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ accepted: true, reference: "provider-receipt" }),
      );
    vi.stubGlobal("fetch", fetcher);
    expect(await provider.send(job)).toEqual({
      state: "accepted",
      reference: "provider-receipt",
    });
    const init = fetcher.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.redirect).toBe("error");
    expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toBe(
      job.id,
    );
  });
  it("treats timeouts, server errors, and malformed receipts as unknown without retries", async () => {
    const provider = webhook();
    for (const response of [
      new Response("", { status: 500 }),
      Response.json({ accepted: true }),
      new Response("not-json"),
    ]) {
      const fetcher = vi.fn(async () => response);
      vi.stubGlobal("fetch", fetcher);
      expect((await provider.send(job)).state).toBe("unknown");
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    const failure = vi.fn(async () => {
      throw new Error("timeout");
    });
    vi.stubGlobal("fetch", failure);
    expect((await provider.send(job)).state).toBe("unknown");
    expect(failure).toHaveBeenCalledTimes(1);
  });
  it("keeps unrecorded provider acceptance separate from database success", async () => {
    const provider = {
      name: "webhook" as const,
      send: vi.fn(async () => ({ state: "accepted" as const, reference: "r" })),
    };
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: [job], error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "database down" },
      });
    expect(
      await dispatchEngagement([provider], {
        rpc,
      } as unknown as SupabaseClient),
    ).toMatchObject({ accepted: 0, unknown: 1 });
    expect(provider.send).toHaveBeenCalledTimes(1);
  });
  it("verifies a saved Google pass and sends the official message shape", async () => {
    vi.stubEnv(
      "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON",
      JSON.stringify({
        client_email: "test@example.com",
        private_key: "x".repeat(150),
      }),
    );
    vi.stubEnv("GOOGLE_WALLET_ISSUER_ID", "1234567890");
    const target = googleObjectId(job.orgId, job.memberId);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: target, hasUsers: true }))
      .mockResolvedValueOnce(Response.json({ resource: { id: target } }));
    vi.stubGlobal("fetch", fetcher);
    const google = deliveryProviders()[0]!;
    expect(
      await google.send({ ...job, provider: "google_wallet", target }),
    ).toEqual({ state: "accepted", reference: job.id });
    expect(fetcher.mock.calls[1]?.[0]).toContain(
      `/loyaltyObject/${target}/addMessage`,
    );
    expect(
      JSON.parse((fetcher.mock.calls[1]?.[1] as RequestInit).body as string),
    ).toEqual({
      message: {
        id: job.id,
        header: job.title,
        body: job.body,
        messageType: "TEXT_AND_NOTIFY",
      },
    });
  });
});
