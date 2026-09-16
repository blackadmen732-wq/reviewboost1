import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const load = () => import("@/lib/server/sms/pricing/cost-model");
const RATE = {
  perSegmentMicros: 7500,
  carrierSurchargeMicros: 500,
  currency: "USD",
  provider: "twilio",
  usedCurrentPrice: false,
  rateVersion: 1,
};

describe("expected cost model — separately auditable components", () => {
  it("costs a single segment as provider + carrier with zero allocations", async () => {
    const { expectedCost } = await load();
    const c = expectedCost(1, RATE);
    expect(c.providerSegmentMicros).toBe(7500);
    expect(c.carrierSurchargeMicros).toBe(500);
    expect(c.totalMicros).toBe(8000);
    expect(c.usedCurrentPrice).toBe(false);
  });

  it("multiplies provider and carrier cost by the segment count", async () => {
    const { expectedCost } = await load();
    const c = expectedCost(3, RATE);
    expect(c.providerSegmentMicros).toBe(22500);
    expect(c.carrierSurchargeMicros).toBe(1500);
    expect(c.totalMicros).toBe(24000);
  });

  it("keeps every allocation line separate and sums them exactly", async () => {
    const { expectedCost } = await load();
    const policy = {
      providerFixedMicros: 100,
      numberRegistrationMicros: 200,
      infrastructureMicros: 300,
      reconciliationReserveBps: 1000, // 10% of raw spend (8000) = 800
      paymentProcessingMicros: 0,
    };
    const c = expectedCost(1, RATE, policy);
    expect(c.providerFixedMicros).toBe(100);
    expect(c.numberRegistrationMicros).toBe(200);
    expect(c.infrastructureMicros).toBe(300);
    expect(c.reconciliationReserveMicros).toBe(800); // ceil(8000*1000/10000)
    // 7500 + 500 + 100 + 200 + 300 + 800 = 9400
    expect(c.totalMicros).toBe(9400);
  });

  it("rounds the reconciliation reserve up so it is never short", async () => {
    const { expectedCost } = await load();
    // raw spend 8000, reserve 333 bps → 8000*333/10000 = 266.4 → ceil 267.
    const c = expectedCost(1, RATE, {
      providerFixedMicros: 0,
      numberRegistrationMicros: 0,
      infrastructureMicros: 0,
      reconciliationReserveBps: 333,
      paymentProcessingMicros: 0,
    });
    expect(c.reconciliationReserveMicros).toBe(267);
  });

  it("rejects zero or negative segment counts and unsafe rates", async () => {
    const { expectedCost } = await load();
    expect(() => expectedCost(0, RATE)).toThrow(/positive/i);
    expect(() => expectedCost(1, { ...RATE, perSegmentMicros: -1 })).toThrow();
    expect(() =>
      expectedCost(2, { ...RATE, perSegmentMicros: Number.MAX_SAFE_INTEGER }),
    ).toThrow(/safe integer/i);
  });

  it("reflects the account-specific current price flag through the breakdown", async () => {
    const { expectedCost } = await load();
    const c = expectedCost(1, { ...RATE, usedCurrentPrice: true });
    expect(c.usedCurrentPrice).toBe(true);
  });
});
