import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const load = () => import("@/lib/server/sms/pricing/router");
import type { NormalizedRate } from "@/lib/server/sms/pricing/rates";
import type { RouteCandidate } from "@/lib/server/sms/pricing/router";

const NOW = new Date("2026-09-03T00:00:00Z");

function rate(overrides: Partial<NormalizedRate> = {}): NormalizedRate {
  return {
    provider: "twilio",
    country: "US",
    mcc: null,
    mnc: null,
    carrier: null,
    numberType: "long_code",
    direction: "outbound",
    basePriceMicros: 7500,
    currentPriceMicros: null,
    carrierSurchargeMicros: 0,
    currency: "USD",
    source: "manual_deck",
    effectiveAt: NOW,
    fetchedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 3600_000),
    rateVersion: 1,
    ...overrides,
  };
}

function candidate(overrides: Partial<RouteCandidate> = {}): RouteCandidate {
  return {
    provider: "twilio",
    rate: rate(),
    segments: 1,
    healthBps: 9800,
    recentDeliveryRateBps: 9900,
    supportsDestination: true,
    registrationReady: true,
    throughputHeadroom: 100,
    ...overrides,
  };
}

describe("provider router — validity before price", () => {
  it("rejects invalid routes before considering cost", async () => {
    const { selectRoute } = await load();
    const cases: Array<[Partial<RouteCandidate>, string]> = [
      [{ supportsDestination: false }, "unsupported_destination"],
      [{ registrationReady: false }, "registration_missing"],
      [{ throughputHeadroom: 0 }, "no_throughput"],
      [{ healthBps: 8000 }, "unhealthy"],
      [{ recentDeliveryRateBps: 9000 }, "low_delivery_rate"],
      [{ rate: rate({ expiresAt: new Date(NOW.getTime() - 1000) }) }, "rate_stale"],
      [{ rate: rate({ currency: "EUR" }) }, "currency_mismatch"],
    ];
    for (const [override, reason] of cases) {
      const d = selectRoute([candidate({ provider: "p", ...override })], {
        requiredCurrency: "USD",
        now: NOW,
      });
      expect(d.chosen).toBeNull();
      expect(d.candidates[0]!.rejection).toBe(reason);
    }
  });

  it("selects the cheapest eligible route", async () => {
    const { selectRoute } = await load();
    const cheap = candidate({ provider: "cheap", rate: rate({ provider: "cheap", basePriceMicros: 5000 }) });
    const dear = candidate({ provider: "dear", rate: rate({ provider: "dear", basePriceMicros: 9000 }) });
    const d = selectRoute([dear, cheap], { requiredCurrency: "USD", now: NOW });
    expect(d.chosen?.provider).toBe("cheap");
    expect(d.chosen?.expectedDeliveredCostMicros).toBe(5000);
  });

  it("flags multiProvider only when ≥2 providers are actually eligible", async () => {
    const { selectRoute } = await load();
    const a = candidate({ provider: "a", rate: rate({ provider: "a" }) });
    const bBad = candidate({ provider: "b", rate: rate({ provider: "b" }), registrationReady: false });
    const single = selectRoute([a, bBad], { requiredCurrency: "USD", now: NOW });
    expect(single.chosen?.provider).toBe("a");
    expect(single.multiProvider).toBe(false); // b was rejected — no real failover

    const bGood = candidate({ provider: "b", rate: rate({ provider: "b", basePriceMicros: 8000 }) });
    const multi = selectRoute([a, bGood], { requiredCurrency: "USD", now: NOW });
    expect(multi.multiProvider).toBe(true);
  });

  it("returns chosen=null with a rationale when no route is eligible (fail closed)", async () => {
    const { selectRoute } = await load();
    const d = selectRoute([candidate({ supportsDestination: false })], { requiredCurrency: "USD", now: NOW });
    expect(d.chosen).toBeNull();
    expect(d.rationale).toMatch(/no eligible route/i);
  });

  it("breaks a cost tie toward the higher recent delivery rate", async () => {
    const { selectRoute } = await load();
    const lo = candidate({ provider: "lo", rate: rate({ provider: "lo" }), recentDeliveryRateBps: 9600 });
    const hi = candidate({ provider: "hi", rate: rate({ provider: "hi" }), recentDeliveryRateBps: 9999 });
    const d = selectRoute([lo, hi], { requiredCurrency: "USD", now: NOW });
    expect(d.chosen?.provider).toBe("hi");
  });

  it("returns the winner's candidateIndex so the exact winning candidate is unambiguous", async () => {
    const { selectRoute } = await load();
    // Two candidates from the SAME provider — the second is cheaper and should
    // be chosen. Finding by provider name alone would return the first (wrong).
    const dear = candidate({ provider: "twilio", rate: rate({ provider: "twilio", basePriceMicros: 9000, rateVersion: 1 }) });
    const cheap = candidate({ provider: "twilio", rate: rate({ provider: "twilio", basePriceMicros: 4000, rateVersion: 2 }) });
    const d = selectRoute([dear, cheap], { requiredCurrency: "USD", now: NOW });
    expect(d.chosen).not.toBeNull();
    expect(d.chosen!.candidateIndex).toBe(1);
    expect(d.chosen!.expectedDeliveredCostMicros).toBe(4000);
    // Sanity: every evaluated route carries its index too.
    expect(d.candidates[0]!.candidateIndex).toBe(0);
    expect(d.candidates[1]!.candidateIndex).toBe(1);
  });

  it("prefers the account current price when present", async () => {
    const { selectRoute } = await load();
    const c = candidate({ rate: rate({ currentPriceMicros: 4000 }) });
    const d = selectRoute([c], { requiredCurrency: "USD", now: NOW });
    expect(d.chosen?.expectedDeliveredCostMicros).toBe(4000);
    expect(d.chosen?.usedCurrentPrice).toBe(true);
  });
});
