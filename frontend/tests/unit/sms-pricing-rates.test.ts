import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const loadRates = () => import("@/lib/server/sms/pricing/rates");
const loadTwilio = () => import("@/lib/server/sms/pricing/rates-twilio");
const loadDeck = () => import("@/lib/server/sms/pricing/rates-manual-deck");
import type { NormalizedRate } from "@/lib/server/sms/pricing/rates";

const NOW = new Date("2026-09-03T00:00:00Z");
function rate(over: Partial<NormalizedRate> = {}): NormalizedRate {
  return {
    provider: "twilio", country: "US", mcc: null, mnc: null, carrier: null,
    numberType: "long_code", direction: "outbound",
    basePriceMicros: 7500, currentPriceMicros: null, carrierSurchargeMicros: null,
    currency: "USD", source: "manual_deck", effectiveAt: NOW, fetchedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 3600_000), rateVersion: 1, ...over,
  };
}

describe("rate normalization + staleness", () => {
  it("treats a rate past its expiry as stale, fresh otherwise", async () => {
    const { isRateStale } = await loadRates();
    expect(isRateStale(rate(), NOW)).toBe(false);
    expect(isRateStale(rate({ expiresAt: new Date(NOW.getTime() - 1) }), NOW)).toBe(true);
    expect(isRateStale(rate({ expiresAt: null }), NOW)).toBe(false); // deck: perpetual
  });

  it("prefers the current price over the base price and validates integers", async () => {
    const { toEffectiveRate } = await loadRates();
    expect(toEffectiveRate(rate()).usedCurrentPrice).toBe(false);
    const eff = toEffectiveRate(rate({ currentPriceMicros: 4000 }));
    expect(eff.perSegmentMicros).toBe(4000);
    expect(eff.usedCurrentPrice).toBe(true);
    expect(() => toEffectiveRate(rate({ basePriceMicros: 1.5 }))).toThrow();
    expect(() => toEffectiveRate(rate({ currency: "usd" }))).toThrow();
  });
});

describe("Twilio rate adapter — fail closed, never invented", () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
  });

  it("reports unconfigured and throws on ingest without credentials", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    const { TwilioRateAdapter } = await loadTwilio();
    const a = new TwilioRateAdapter();
    expect(a.configured()).toBe(false);
    await expect(
      a.ingest({ provider: "twilio", country: "US", numberType: "long_code", direction: "outbound" }),
    ).rejects.toThrow(/not configured/i);
  });
});

describe("manual deck adapter — serves imported rows only", () => {
  it("returns covered rows and nothing for uncovered keys", async () => {
    const { ManualDeckRateAdapter } = await loadDeck();
    const deck = [rate({ provider: "telnyx", country: "US", basePriceMicros: 6000 })];
    const a = new ManualDeckRateAdapter("telnyx", deck);
    expect(a.configured()).toBe(true);
    const us = await a.ingest({ provider: "telnyx", country: "US", numberType: "long_code", direction: "outbound" });
    expect(us).toHaveLength(1);
    expect(us[0]!.basePriceMicros).toBe(6000);
    const gb = await a.ingest({ provider: "telnyx", country: "GB", numberType: "long_code", direction: "outbound" });
    expect(gb).toHaveLength(0); // uncovered → nothing, never a fabricated price
  });

  it("supersedes an older row with a higher rateVersion on re-import", async () => {
    const { ManualDeckRateAdapter } = await loadDeck();
    const deck = [
      rate({ provider: "telnyx", basePriceMicros: 6000, rateVersion: 1 }),
      rate({ provider: "telnyx", basePriceMicros: 5000, rateVersion: 2 }),
    ];
    const a = new ManualDeckRateAdapter("telnyx", deck);
    const rows = await a.ingest({ provider: "telnyx", country: "US", numberType: "long_code", direction: "outbound" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.basePriceMicros).toBe(5000);
  });

  it("rejects a deck row that is not manual_deck or belongs to another provider", async () => {
    const { ManualDeckRateAdapter } = await loadDeck();
    expect(() => new ManualDeckRateAdapter("telnyx", [rate({ provider: "twilio" })])).toThrow();
    expect(() => new ManualDeckRateAdapter("telnyx", [rate({ provider: "telnyx", source: "twilio_pricing_api" })])).toThrow();
  });
});
