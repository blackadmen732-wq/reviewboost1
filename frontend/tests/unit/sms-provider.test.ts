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

  it("reports retryable for a programmed retryable number", async () => {
    const { FakeSmsProvider } = await loadFake();
    const p = new FakeSmsProvider({ retryableNumbers: new Set(["+15550000002"]) });
    const r = await p.send({ to: "+15550000002", body: "hi" });
    expect(r).toMatchObject({ outcome: "retryable", errorClass: "rate_limited" });
  });

  it("reports provider_unknown for a programmed timeout", async () => {
    const { FakeSmsProvider } = await loadFake();
    const p = new FakeSmsProvider({ unknownNumbers: new Set(["+15550000001"]) });
    const r = await p.send({ to: "+15550000001", body: "hi" });
    expect(r.outcome).toBe("provider_unknown");
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

  it("returns retryable for a 429 response", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    process.env.TWILIO_AUTH_TOKEN = "test_auth_token";
    process.env.TWILIO_FROM_NUMBER = "+15550001111";
    const { TwilioSmsProvider } = await loadTwilio();
    const provider = new TwilioSmsProvider();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ code: 20429 }),
      }),
    );
    const r = await provider.send({ to: "+15551230000", body: "hi" });
    expect(r).toMatchObject({ outcome: "retryable", errorClass: "rate_limited" });
    vi.unstubAllGlobals();
  });

  it("returns retryable for a 500 response", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    process.env.TWILIO_AUTH_TOKEN = "test_auth_token";
    process.env.TWILIO_FROM_NUMBER = "+15550001111";
    const { TwilioSmsProvider } = await loadTwilio();
    const provider = new TwilioSmsProvider();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      }),
    );
    const r = await provider.send({ to: "+15551230000", body: "hi" });
    expect(r.outcome).toBe("retryable");
    vi.unstubAllGlobals();
  });

  it("returns failed for a 400 response", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    process.env.TWILIO_AUTH_TOKEN = "test_auth_token";
    process.env.TWILIO_FROM_NUMBER = "+15550001111";
    const { TwilioSmsProvider } = await loadTwilio();
    const provider = new TwilioSmsProvider();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ code: 21211 }),
      }),
    );
    const r = await provider.send({ to: "+15551230000", body: "hi" });
    expect(r).toMatchObject({ outcome: "failed", errorClass: "invalid_number" });
    vi.unstubAllGlobals();
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
