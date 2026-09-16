import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const load = () => import("@/lib/server/sms/pricing/margin");

describe("margin engine — integer basis-point pricing", () => {
  it("prices to 70% / 78% / 85% and never realises below target", async () => {
    const { priceToMargin } = await load();
    const cost = 1000; // micro-units
    // Expected sell prices are ceil(cost*10000/(10000-marginBps)).
    const at70 = priceToMargin(cost, 7000);
    const at78 = priceToMargin(cost, 7800);
    const at85 = priceToMargin(cost, 8500);
    expect(at70.sellMicros).toBe(3334); // ceil(10_000_000/3000)
    expect(at78.sellMicros).toBe(4546); // ceil(10_000_000/2200)
    expect(at85.sellMicros).toBe(6667); // ceil(10_000_000/1500)
    // Rounding is UP, so realised margin is at or above the target every time.
    expect(at70.realisedMarginBps).toBeGreaterThanOrEqual(7000);
    expect(at78.realisedMarginBps).toBeGreaterThanOrEqual(7800);
    expect(at85.realisedMarginBps).toBeGreaterThanOrEqual(8500);
  });

  it("rounds the sell price up (never down) so a fraction can't breach the floor", async () => {
    const { priceToMargin, realisedMarginBps } = await load();
    // A cost that does not divide evenly must still clear the floor.
    for (let cost = 1; cost <= 500; cost++) {
      const r = priceToMargin(cost, 7000);
      expect(realisedMarginBps(r.sellMicros, cost)).toBeGreaterThanOrEqual(7000);
    }
  });

  it("rejects a target outside the approved band [hardMin, maxTarget]", async () => {
    const { priceToMargin } = await load();
    expect(() => priceToMargin(1000, 6999)).toThrow(/policy band/i); // below 70%
    expect(() => priceToMargin(1000, 8501)).toThrow(/policy band/i); // above 85%
  });

  it("rejects a nonsensical margin at or above 100%", async () => {
    const { priceToMargin, assertMarginPolicy } = await load();
    expect(() => priceToMargin(1000, 10000)).toThrow();
    expect(() =>
      assertMarginPolicy({ hardMinBps: 7000, defaultTargetBps: 7800, maxTargetBps: 10000 }),
    ).toThrow();
  });

  it("rejects an out-of-order policy band", async () => {
    const { assertMarginPolicy } = await load();
    expect(() =>
      assertMarginPolicy({ hardMinBps: 8000, defaultTargetBps: 7800, maxTargetBps: 8500 }),
    ).toThrow(/hardMin ≤ defaultTarget ≤ maxTarget/);
  });

  it("throws rather than overflowing when cost×10000 exceeds the safe range", async () => {
    const { priceToMargin } = await load();
    const hugeCost = Math.floor(Number.MAX_SAFE_INTEGER / 5000);
    expect(() => priceToMargin(hugeCost, 7800)).toThrow(/safe integer/i);
  });

  it("treats a zero-cost message as free at any margin", async () => {
    const { priceToMargin } = await load();
    const r = priceToMargin(0, 7800);
    expect(r.sellMicros).toBe(0);
    expect(r.contributionMicros).toBe(0);
  });

  it("realisedMarginBps floors (understates) and rejects a zero sell price", async () => {
    const { realisedMarginBps } = await load();
    expect(realisedMarginBps(4546, 1000)).toBe(7800);
    expect(() => realisedMarginBps(0, 0)).toThrow(/zero sell price/i);
    // A loss reads as a negative margin, not rounded toward zero.
    expect(realisedMarginBps(1000, 1500)).toBeLessThan(0);
  });

  it("exposes the approved policy constants", async () => {
    const { HARD_MIN_MARGIN_BPS, DEFAULT_TARGET_MARGIN_BPS, MAX_TARGET_MARGIN_BPS } = await load();
    expect(HARD_MIN_MARGIN_BPS).toBe(7000);
    expect(DEFAULT_TARGET_MARGIN_BPS).toBe(7800);
    expect(MAX_TARGET_MARGIN_BPS).toBe(8500);
  });
});
