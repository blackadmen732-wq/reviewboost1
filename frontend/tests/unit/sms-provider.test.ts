import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("server-only", () => ({}));

beforeAll(() => {
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
});

const loadFake = () => import("@/lib/server/sms/provider/fake-provider");
const loadTwilio = () => import("@/lib/server/sms/provider/twilio");
const loadProvider = () => import("@/lib/server/sms/provider");

describe("fake provider", () => {
  afterEach(async () => {
    const { resetFakeAccepted } = await loadFake();
    resetFakeAccepted();
  });

  it("submits by default with a stable message id", async () => {
    const { FakeSmsProvider } = await loadFake();
    const p = new FakeSmsProvider();
    const r1 = await p.send({ to: "+15551230000", body: "hi" });
    const r2 = await p.send({ to: "+15551230000", body: "hi" });
    expect(r1.outcome).toBe("submitted");
    expect(r1.providerMessageId).toBe(r2.providerMessageId);
    expect(p.sent).toHaveLength(2);
  });

  it("derives the message id from the idempotency key (identity, not content)", async () => {
    const { FakeSmsProvider } = await loadFake();
    const p = new FakeSmsProvider();
    // Same idempotency key (a retry of one logical request) → same provider id.
    const a1 = await p.send({ to: "+15551230000", body: "hi", idempotencyKey: "req:abc" });
    const a2 = await p.send({ to: "+15551230000", body: "hi", idempotencyKey: "req:abc" });
    expect(a1.providerMessageId).toBe(a2.providerMessageId);

    // Two distinct logical requests with identical recipient+body must NOT
    // collide (this is the delivery-receipt correlation bug being guarded).
    const b = await p.send({ to: "+15551230000", body: "hi", idempotencyKey: "req:def" });
    expect(b.providerMessageId).not.toBe(a1.providerMessageId);
  });

  it("fails a programmed number with an error class", async () => {
    const { FakeSmsProvider } = await loadFake();
    const p = new FakeSmsProvider({ failNumbers: { "+15550000000": "invalid_number" } });
    const r = await p.send({ to: "+15550000000", body: "hi" });
    expect(r).toMatchObject({ outcome: "failed", errorClass: "invalid_number" });
  });

  it("reports provider_unknown for a programmed timeout", async () => {
    const { FakeSmsProvider } = await loadFake();
    const p = new FakeSmsProvider({ unknownNumbers: new Set(["+15550000001"]) });
    const r = await p.send({ to: "+15550000001", body: "hi", idempotencyKey: "req:never" });
    expect(r.outcome).toBe("provider_unknown");
    const looked = await p.lookup({
      idempotencyKey: "req:never",
      to: "+15550000001",
      body: "hi",
    });
    expect(looked.outcome).toBe("not_found");
  });

  it("shares timeout-after-accept SIDs across FakeSmsProvider instances", async () => {
    const { FakeSmsProvider } = await loadFake();
    const sender = new FakeSmsProvider({ timeoutAfterAcceptNumbers: new Set(["+15550000002"]) });
    const sent = await sender.send({ to: "+15550000002", body: "hi", idempotencyKey: "req:shared" });
    expect(sent.outcome).toBe("provider_unknown");
    const lookuper = new FakeSmsProvider();
    const looked = await lookuper.lookup({
      idempotencyKey: "req:shared",
      to: "+15550000002",
      body: "hi",
    });
    expect(looked.outcome).toBe("found");
  });

  it("timeout-after-accept hides the SID on send and returns it from lookup", async () => {
    const { FakeSmsProvider } = await loadFake();
    const p = new FakeSmsProvider({ timeoutAfterAcceptNumbers: new Set(["+15550000002"]) });
    const sent = await p.send({ to: "+15550000002", body: "hi", idempotencyKey: "req:late-sid" });
    expect(sent.outcome).toBe("provider_unknown");
    expect(sent.providerMessageId).toBeUndefined();
    const looked = await p.lookup({
      idempotencyKey: "req:late-sid",
      to: "+15550000002",
      body: "hi",
    });
    expect(looked.outcome).toBe("found");
    if (looked.outcome === "found") {
      expect(looked.providerMessageId).toMatch(/^fake_/);
    }
  });

  it("lookup is unknown when programmed, and not_found when send never accepted", async () => {
    const { FakeSmsProvider } = await loadFake();
    const p = new FakeSmsProvider({ lookupUnknownNumbers: new Set(["+15550000003"]) });
    const looked = await p.lookup({
      idempotencyKey: "req:missing",
      to: "+15550000003",
      body: "hi",
    });
    expect(looked.outcome).toBe("unknown");

    const p2 = new FakeSmsProvider();
    const missing = await p2.lookup({
      idempotencyKey: "req:never-sent",
      to: "+15550000004",
      body: "hi",
    });
    expect(missing.outcome).toBe("not_found");
  });

  it("parses status and inbound webhooks", async () => {
    const { FakeSmsProvider } = await loadFake();
    const p = new FakeSmsProvider();
    const status = p.parseWebhook({
      url: "https://x/y",
      headers: {},
      rawBody: JSON.stringify({ type: "status", messageId: "fake_1", status: "delivered", eventId: "e1" }),
    });
    expect(status).toMatchObject({ kind: "delivery_status", terminal: "delivered", dedupeKey: "e1" });

    const inbound = p.parseWebhook({
      url: "https://x/y",
      headers: {},
      rawBody: JSON.stringify({ type: "inbound", from: "+15551230000", body: "STOP", eventId: "e2" }),
    });
    expect(inbound).toMatchObject({ kind: "inbound_message", from: "+15551230000", body: "STOP" });
  });

  it("verifies every signature outside production", async () => {
    const { FakeSmsProvider } = await loadFake();
    const p = new FakeSmsProvider();
    expect(p.verifySignature({ url: "https://x", headers: {}, rawBody: "" })).toBe(true);
  });

  it("requires the shared secret for fake webhooks in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const { FakeSmsProvider } = await loadFake();
      const p = new FakeSmsProvider();
      // No secret configured, or a wrong one → rejected.
      vi.stubEnv("SMS_FAKE_WEBHOOK_SECRET", "");
      expect(p.verifySignature({ url: "https://x", headers: {}, rawBody: "" })).toBe(false);
      vi.stubEnv("SMS_FAKE_WEBHOOK_SECRET", "s3cret-value");
      expect(p.verifySignature({ url: "https://x", headers: { "x-fake-signature": "nope" }, rawBody: "" })).toBe(false);
      expect(
        p.verifySignature({ url: "https://x", headers: { "x-fake-signature": "s3cret-value" }, rawBody: "" }),
      ).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("twilio provider", () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
  });

  it("reports itself unconfigured without credentials", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    const { twilioConfigured } = await loadTwilio();
    expect(twilioConfigured()).toBe(false);
  });

  it("throws rather than silently dropping a send when unconfigured", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    const { TwilioSmsProvider } = await loadTwilio();
    await expect(new TwilioSmsProvider().send({ to: "+15551230000", body: "hi" })).rejects.toThrow();
  });

  it("verifies a correct X-Twilio-Signature and rejects a tampered one", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    process.env.TWILIO_AUTH_TOKEN = "test_auth_token";
    process.env.TWILIO_FROM_NUMBER = "+15550001111";
    const { TwilioSmsProvider } = await loadTwilio();
    const provider = new TwilioSmsProvider();

    const url = "https://app.reviewboost.fit/api/v1/webhooks/sms/twilio";
    const rawBody = "Body=STOP&From=%2B15551230000&MessageSid=SM123&MessageStatus=received";
    // Twilio's scheme: HMAC-SHA1 over url + sorted key+value, base64.
    const params = new URLSearchParams(rawBody);
    let data = url;
    for (const k of [...params.keys()].sort()) data += k + (params.get(k) ?? "");
    const signature = createHmac("sha1", "test_auth_token").update(Buffer.from(data, "utf8")).digest("base64");

    expect(provider.verifySignature({ url, headers: { "x-twilio-signature": signature }, rawBody })).toBe(true);
    expect(provider.verifySignature({ url, headers: { "x-twilio-signature": "wrong" }, rawBody })).toBe(false);
    expect(provider.verifySignature({ url, headers: {}, rawBody })).toBe(false);
  });

  it("maps a delivered status webhook", async () => {
    process.env.TWILIO_AUTH_TOKEN = "t";
    process.env.TWILIO_ACCOUNT_SID = "AC";
    process.env.TWILIO_FROM_NUMBER = "+1";
    const { TwilioSmsProvider } = await loadTwilio();
    const r = new TwilioSmsProvider().parseWebhook({
      url: "https://x",
      headers: {},
      rawBody: "MessageSid=SM9&MessageStatus=delivered",
    });
    expect(r).toMatchObject({ kind: "delivery_status", providerMessageId: "SM9", terminal: "delivered" });
  });

  it("maps an undelivered status to a failed terminal", async () => {
    const { TwilioSmsProvider } = await loadTwilio();
    const r = new TwilioSmsProvider().parseWebhook({
      url: "https://x",
      headers: {},
      rawBody: "MessageSid=SM9&MessageStatus=undelivered&ErrorCode=30007",
    });
    expect(r).toMatchObject({ kind: "delivery_status", terminal: "failed", errorClass: "carrier_rejected" });
  });

  it("maps an inbound message", async () => {
    const { TwilioSmsProvider } = await loadTwilio();
    const r = new TwilioSmsProvider().parseWebhook({
      url: "https://x",
      headers: {},
      rawBody: "MessageSid=SM9&From=%2B15551230000&Body=STOP",
    });
    expect(r).toMatchObject({ kind: "inbound_message", from: "+15551230000", body: "STOP" });
  });

  it("classifies an inbound STOP as inbound even when it carries SmsStatus=received", async () => {
    // Twilio tags inbound messages with SmsStatus=received AND a MessageSid, so
    // classifying by status alone would misroute every STOP/START into the
    // delivery-status branch. The inbound Body is the reliable discriminator.
    const { TwilioSmsProvider } = await loadTwilio();
    const r = new TwilioSmsProvider().parseWebhook({
      url: "https://x",
      headers: {},
      rawBody: "MessageSid=SM9&SmsStatus=received&From=%2B15551230000&Body=STOP",
    });
    expect(r).toMatchObject({ kind: "inbound_message", from: "+15551230000", body: "STOP" });
  });
});

describe("twilio send outcome classification", () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
    vi.restoreAllMocks();
  });

  function configureEnv() {
    process.env.TWILIO_ACCOUNT_SID = "ACtest00000000000000000000000000";
    process.env.TWILIO_AUTH_TOKEN = "test_auth_token";
    process.env.TWILIO_FROM_NUMBER = "+15550001111";
  }

  it("returns retryable on HTTP 429", async () => {
    configureEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ code: 20429 }),
      }),
    );
    const { TwilioSmsProvider } = await loadTwilio();
    const result = await new TwilioSmsProvider().send({ to: "+15551230000", body: "hi" });
    expect(result.outcome).toBe("retryable");
    expect(result.errorClass).toBe("rate_limited");
  });

  it("returns provider_unknown on HTTP 500 (ambiguous, do NOT retry)", async () => {
    configureEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ code: 20500 }),
      }),
    );
    const { TwilioSmsProvider } = await loadTwilio();
    const result = await new TwilioSmsProvider().send({ to: "+15551230000", body: "hi" });
    expect(result.outcome).toBe("provider_unknown");
    expect(result.errorClass).toBe("provider_error");
  });

  it("returns provider_unknown on HTTP 503", async () => {
    configureEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({}),
      }),
    );
    const { TwilioSmsProvider } = await loadTwilio();
    const result = await new TwilioSmsProvider().send({ to: "+15551230000", body: "hi" });
    expect(result.outcome).toBe("provider_unknown");
  });

  it("returns failed on HTTP 400 (clear rejection)", async () => {
    configureEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ code: 21211 }),
      }),
    );
    const { TwilioSmsProvider } = await loadTwilio();
    const result = await new TwilioSmsProvider().send({ to: "+15551230000", body: "hi" });
    expect(result.outcome).toBe("failed");
    expect(result.errorClass).toBe("invalid_number");
  });

  it("returns failed on HTTP 401 (auth error = clear rejection)", async () => {
    configureEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
      }),
    );
    const { TwilioSmsProvider } = await loadTwilio();
    const result = await new TwilioSmsProvider().send({ to: "+15551230000", body: "hi" });
    expect(result.outcome).toBe("failed");
  });

  it("returns provider_unknown on network timeout (not retryable)", async () => {
    configureEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("The operation was aborted due to timeout")),
    );
    const { TwilioSmsProvider } = await loadTwilio();
    const result = await new TwilioSmsProvider().send({ to: "+15551230000", body: "hi" });
    expect(result.outcome).toBe("provider_unknown");
    expect(result.errorClass).toBe("timeout");
  });

  it("returns submitted on HTTP 201 with SID", async () => {
    configureEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ sid: "SM123abc", status: "queued" }),
      }),
    );
    const { TwilioSmsProvider } = await loadTwilio();
    const result = await new TwilioSmsProvider().send({ to: "+15551230000", body: "hi" });
    expect(result.outcome).toBe("submitted");
    expect(result.providerMessageId).toBe("SM123abc");
  });

  it("lookup is unknown when Twilio is not configured (does not invent not_found)", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { TwilioSmsProvider } = await loadTwilio();
    const result = await new TwilioSmsProvider().lookup({
      idempotencyKey: "req:x",
      to: "+15551230000",
      body: "hi",
    });
    expect(result.outcome).toBe("unknown");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lookup GETs Messages and never POSTs a new send", async () => {
    configureEnv();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          messages: [{ sid: "SMrecovered", status: "delivered", body: "hi", date_created: "2026-09-08T12:00:00Z" }],
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { TwilioSmsProvider } = await loadTwilio();
    const result = await new TwilioSmsProvider().lookup({
      idempotencyKey: "req:x",
      to: "+15551230000",
      body: "hi",
      sentAfter: new Date("2026-09-08T11:00:00Z"),
    });
    expect(result).toMatchObject({ outcome: "found", providerMessageId: "SMrecovered", terminal: "delivered" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("GET");
    expect(url).toContain("/Messages.json");
    expect(url).toContain(encodeURIComponent("+15551230000"));
  });

  it("lookup finds a singleton only when the body matches exactly", async () => {
    configureEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            messages: [{ sid: "SMexact", status: "queued", body: "hi", date_created: "2026-09-08T12:00:00Z" }],
          }),
      }),
    );
    const { TwilioSmsProvider } = await loadTwilio();
    const result = await new TwilioSmsProvider().lookup({
      idempotencyKey: "req:x",
      to: "+15551230000",
      body: "hi",
    });
    expect(result).toMatchObject({ outcome: "found", providerMessageId: "SMexact" });
  });

  it("lookup is unknown for a lone candidate whose body does not match", async () => {
    // SENTINEL lock: same To + date window, different body → never attach that SID.
    configureEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            messages: [{ sid: "SMother", status: "delivered", body: "different", date_created: "2026-09-08T12:00:00Z" }],
          }),
      }),
    );
    const { TwilioSmsProvider } = await loadTwilio();
    const result = await new TwilioSmsProvider().lookup({
      idempotencyKey: "req:x",
      to: "+15551230000",
      body: "hi",
      sentAfter: new Date("2026-09-08T11:00:00Z"),
    });
    expect(result.outcome).toBe("unknown");
    expect(result).not.toHaveProperty("providerMessageId");
    expect(result.raw).toMatchObject({ error: "no_body_match" });
  });

  it("lookup is unknown when two messages share the exact body (ambiguous)", async () => {
    configureEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            messages: [
              { sid: "SMone", status: "delivered", body: "hi", date_created: "2026-09-08T12:00:00Z" },
              { sid: "SMtwo", status: "delivered", body: "hi", date_created: "2026-09-08T12:05:00Z" },
            ],
          }),
      }),
    );
    const { TwilioSmsProvider } = await loadTwilio();
    const result = await new TwilioSmsProvider().lookup({
      idempotencyKey: "req:x",
      to: "+15551230000",
      body: "hi",
    });
    expect(result.outcome).toBe("unknown");
    expect(result).not.toHaveProperty("providerMessageId");
    expect(result.raw).toMatchObject({ error: "ambiguous_match", count: 2 });
  });

  it("lookup is unknown when a full page has no match (do not fail+release)", async () => {
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
      idempotencyKey: "req:x",
      to: "+15551230000",
      body: "hi",
    });
    expect(result.outcome).toBe("unknown");
    expect(result.outcome).not.toBe("not_found");
    expect(result).not.toHaveProperty("providerMessageId");
    expect(result.raw).toMatchObject({ error: "lookup_page_truncated", count: 50 });
  });

  it("lookup returns not_found when the list is empty", async () => {
    configureEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ messages: [] }),
      }),
    );
    const { TwilioSmsProvider } = await loadTwilio();
    const result = await new TwilioSmsProvider().lookup({
      idempotencyKey: "req:x",
      to: "+15551230000",
      body: "hi",
    });
    expect(result.outcome).toBe("not_found");
  });

  it("lookup returns unknown on a 5xx list response", async () => {
    configureEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({}),
      }),
    );
    const { TwilioSmsProvider } = await loadTwilio();
    const result = await new TwilioSmsProvider().lookup({
      idempotencyKey: "req:x",
      to: "+15551230000",
      body: "hi",
    });
    expect(result.outcome).toBe("unknown");
  });
});

describe("fake provider retryable outcome", () => {
  it("returns retryable for a programmed retryable number", async () => {
    const { FakeSmsProvider } = await loadFake();
    const p = new FakeSmsProvider({ retryableNumbers: new Set(["+15559990000"]) });
    const r = await p.send({ to: "+15559990000", body: "hi" });
    expect(r.outcome).toBe("retryable");
    expect(r.errorClass).toBe("rate_limited");
  });
});

describe("provider rate configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a valid safe-integer rate", async () => {
    vi.stubEnv("SMS_RATE_PER_SEGMENT_MICROS", "7500");
    vi.stubEnv("SMS_RATE_CURRENCY", "USD");
    const { getProviderRate } = await loadProvider();
    expect(getProviderRate()).toEqual({ perSegmentMicros: 7500, currency: "USD" });
  });

  it("rejects a configured rate above the safe-integer range", async () => {
    // 2^53 + 1 is an integer string that Number() rounds — must be rejected.
    vi.stubEnv("SMS_RATE_PER_SEGMENT_MICROS", "9007199254740993");
    const { getProviderRate } = await loadProvider();
    expect(() => getProviderRate()).toThrow();
  });

  it("rejects a negative or non-numeric configured rate", async () => {
    vi.stubEnv("SMS_RATE_PER_SEGMENT_MICROS", "-5");
    const { getProviderRate } = await loadProvider();
    expect(() => getProviderRate()).toThrow();
    vi.stubEnv("SMS_RATE_PER_SEGMENT_MICROS", "abc");
    const mod = await loadProvider();
    expect(() => mod.getProviderRate()).toThrow();
  });
});
