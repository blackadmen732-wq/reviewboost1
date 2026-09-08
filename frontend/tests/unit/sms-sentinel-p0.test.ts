import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * SENTINEL isolated P0 review for PR #47 head 64e76371f4dd9c6b528139ba3cb7bdd8b3a4ed4b.
 * Synthetic Twilio list payloads only — no live gateway.
 */

vi.mock("server-only", () => ({}));

beforeAll(() => {
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
});

const loadTwilio = () => import("@/lib/server/sms/provider/twilio");

function configureEnv() {
  process.env.TWILIO_ACCOUNT_SID = "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  process.env.TWILIO_AUTH_TOKEN = "token";
  process.env.TWILIO_FROM_NUMBER = "+15550001111";
}

describe("SENTINEL P0 — Twilio lookup body correlation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;
  });

  it("REJECTED original P0: a lone different-body candidate is unknown (never attach)", async () => {
    configureEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            messages: [
              { sid: "SMother", status: "delivered", body: "different", date_created: "2026-09-08T12:00:00Z" },
            ],
          }),
      }),
    );
    const { TwilioSmsProvider } = await loadTwilio();
    const result = await new TwilioSmsProvider().lookup({
      idempotencyKey: "req:victim",
      to: "+15551230000",
      body: "How was your visit? Tap here to leave a review: https://app.example.com/q/stand-a",
    });
    expect(result.outcome).toBe("unknown");
    expect(result).toMatchObject({ raw: { error: "no_body_match" } });
  });

  it("REJECTED original P0: a full page without a body match is unknown (not not_found)", async () => {
    configureEnv();
    const messages = Array.from({ length: 50 }, (_, i) => ({
      sid: `SM${String(i).padStart(4, "0")}`,
      status: "delivered",
      body: "other",
      date_created: "2026-09-08T12:00:00Z",
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ messages }),
      }),
    );
    const { TwilioSmsProvider } = await loadTwilio();
    const result = await new TwilioSmsProvider().lookup({
      idempotencyKey: "req:victim",
      to: "+15551230000",
      body: "hi",
    });
    expect(result.outcome).toBe("unknown");
    expect(result).toMatchObject({ raw: { error: "lookup_page_truncated" } });
  });

  it("two identical bodies are ambiguous (unknown) — fail-closed when both exist", async () => {
    configureEnv();
    const body = "How was your visit? Tap here to leave a review: https://app.example.com/q/stand-a";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            messages: [
              { sid: "SM_first", status: "delivered", body, date_created: "2026-09-08T10:00:00Z" },
              { sid: "SM_second", status: "queued", body, date_created: "2026-09-08T12:00:00Z" },
            ],
          }),
      }),
    );
    const { TwilioSmsProvider } = await loadTwilio();
    const result = await new TwilioSmsProvider().lookup({
      idempotencyKey: "req:second",
      to: "+15551230000",
      body,
    });
    expect(result.outcome).toBe("unknown");
    expect(result).toMatchObject({ raw: { error: "ambiguous_match", count: 2 } });
  });

  it("RESIDUAL: same-body singleton inside the 60s window attaches another send's SID", async () => {
    configureEnv();
    const body = "How was your visit? Tap here to leave a review: https://app.example.com/q/stand-a";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            messages: [
              // Within sentAfter - 60s, so it stays a candidate.
              { sid: "SM_PRIOR_SEND", status: "delivered", body, date_created: "2026-09-08T11:56:00Z" },
            ],
          }),
      }),
    );
    const { TwilioSmsProvider } = await loadTwilio();
    const result = await new TwilioSmsProvider().lookup({
      idempotencyKey: "req:later-timeout",
      to: "+15551230000",
      body,
      sentAfter: new Date("2026-09-08T11:55:00Z"),
    });
    // Current SHA: exact body + singleton => found. Secure contract is unknown
    // unless the candidate can be proven to be THIS request (idempotency / unique SID).
    expect(result).toMatchObject({ outcome: "found", providerMessageId: "SM_PRIOR_SEND", terminal: "delivered" });
  });

  it("RESIDUAL: older same-day traffic is time-filtered away, then treated as not_found", async () => {
    configureEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            messages: [
              { sid: "SMold", status: "delivered", body: "other", date_created: "2026-09-08T08:00:00Z" },
            ],
          }),
      }),
    );
    const { TwilioSmsProvider } = await loadTwilio();
    const result = await new TwilioSmsProvider().lookup({
      idempotencyKey: "req:timeout",
      to: "+15551230000",
      body: "hi",
      sentAfter: new Date("2026-09-08T12:00:00Z"),
    });
    // DateSent> is date-granular so Twilio still returns the 08:00 message.
    // The client then drops it (created < sentAfter - 60s) and treats the
    // remaining empty candidate list as not_found — fail+release after grace.
    expect(result.outcome).toBe("not_found");
  });

  it("idempotency key is not sent on the Messages list query", async () => {
    configureEnv();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ messages: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { TwilioSmsProvider } = await loadTwilio();
    await new TwilioSmsProvider().lookup({
      idempotencyKey: "req:never-used-by-twilio-list",
      to: "+15551230000",
      body: "hi",
      sentAfter: new Date("2026-09-08T11:00:00Z"),
    });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("never-used-by-twilio-list");
    expect(url).not.toContain("Idempotency");
    expect(url).toContain("DateSent");
  });
});
