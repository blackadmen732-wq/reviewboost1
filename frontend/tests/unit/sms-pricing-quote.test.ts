import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const load = () => import("@/lib/server/sms/pricing/quote");
import type { NormalizedRate } from "@/lib/server/sms/pricing/rates";
import type { RouteCandidate } from "@/lib/server/sms/pricing/router";

const NOW = new Date("2026-09-03T00:00:00Z");

function candidate(over: Partial<NormalizedRate> = {}, cand: Partial<RouteCandidate> = {}): RouteCandidate {
  const rate: NormalizedRate = {
    provider: "twilio", country: "US", mcc: null, mnc: null, carrier: null,
    numberType: "long_code", direction: "outbound",
    basePriceMicros: 7500, currentPriceMicros: null, carrierSurchargeMicros: 0,
    currency: "USD", source: "manual_deck", effectiveAt: NOW, fetchedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 3600_000), rateVersion: 1, ...over,
  };
  return {
    provider: rate.provider, rate, segments: 1, healthBps: 9800, recentDeliveryRateBps: 9900,
    supportsDestination: true, registrationReady: true, throughputHeadroom: 100, ...cand,
  };
}

describe("quote engine", () => {
  it("prices a single-segment GSM-7 message end to end at the default 78% target", async () => {
    const { buildQuote } = await load();
    const q = buildQuote({
      body: "Tap here to leave a review.",
      candidates: [candidate()],
      requiredCurrency: "USD",
      ttlSeconds: 900,
      now: NOW,
    });
    expect(q.segments).toBe(1);
    expect(q.expectedCostMicros).toBe(7500);
    expect(q.targetMarginBps).toBe(7800);
    expect(q.sellMicros).toBe(34091); // ceil(7500*10000/2200)
    expect(q.realisedMarginBps).toBeGreaterThanOrEqual(7800);
    expect(q.provider).toBe("twilio");
  });

  it("counts multiple segments for a long body and costs them all", async () => {
    const { buildQuote } = await load();
    const q = buildQuote({
      body: "a".repeat(200), // 2 GSM-7 segments
      candidates: [candidate()],
      requiredCurrency: "USD",
      ttlSeconds: 900,
      now: NOW,
    });
    expect(q.segments).toBe(2);
    expect(q.expectedCostMicros).toBe(15000);
  });

  it("counts Unicode (UCS-2) segments correctly", async () => {
    const { buildQuote } = await load();
    const q = buildQuote({
      body: "Thanks 🙏 leave a review",
      candidates: [candidate()],
      requiredCurrency: "USD",
      ttlSeconds: 900,
      now: NOW,
    });
    expect(q.encoding).toBe("ucs2");
    expect(q.segments).toBeGreaterThanOrEqual(1);
  });

  it("is immutable/reproducible: identical inputs → identical quoteHash", async () => {
    const { buildQuote } = await load();
    const args = { body: "hi", candidates: [candidate()], requiredCurrency: "USD" as const, ttlSeconds: 900, now: NOW };
    const a = buildQuote(args);
    const b = buildQuote(args);
    expect(a.quoteHash).toBe(b.quoteHash);
    // A different body changes the hash.
    const c = buildQuote({ ...args, body: "hello" });
    expect(c.quoteHash).not.toBe(a.quoteHash);
  });

  it("fails closed (throws) when no route is available", async () => {
    const { buildQuote } = await load();
    expect(() =>
      buildQuote({
        body: "hi",
        candidates: [candidate({}, { supportsDestination: false })],
        requiredCurrency: "USD",
        ttlSeconds: 900,
        now: NOW,
      }),
    ).toThrow(/no route/i);
  });

  it("fails closed on a currency mismatch across the whole candidate set", async () => {
    const { buildQuote } = await load();
    expect(() =>
      buildQuote({
        body: "hi",
        candidates: [candidate({ currency: "EUR" })],
        requiredCurrency: "USD",
        ttlSeconds: 900,
        now: NOW,
      }),
    ).toThrow(/no route/i);
  });

  it("computes an expiry and reports expiry correctly", async () => {
    const { buildQuote, isQuoteExpired } = await load();
    const q = buildQuote({ body: "hi", candidates: [candidate()], requiredCurrency: "USD", ttlSeconds: 900, now: NOW });
    expect(isQuoteExpired(q, NOW)).toBe(false);
    expect(isQuoteExpired(q, new Date(NOW.getTime() + 900_000))).toBe(true);
  });
});
