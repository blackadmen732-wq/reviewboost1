import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const load = () => import("@/lib/server/sms/pricing/reconciliation");

const BASE = {
  estimatedProviderCostMicros: 7500,
  estimatedCarrierCostMicros: 500,
  actualProviderCostMicros: null as number | null,
  actualCarrierCostMicros: null as number | null,
  chargedCredits: 1,
  customerRevenueMicros: 34091,
  currency: "USD",
};

describe("actual-cost reconciliation", () => {
  it("stays 'estimated' and reports no realised margin until the provider settles", async () => {
    const { reconcile } = await load();
    const r = reconcile(BASE);
    expect(r.state).toBe("estimated");
    expect(r.effectiveCostMicros).toBe(8000); // falls back to estimate
    expect(r.actualGrossMarginBps).toBeNull(); // never guessed
    expect(r.actualContributionMicros).toBe(34091 - 8000);
  });

  it("marks 'partially_settled' when only the provider actual has arrived", async () => {
    const { reconcile } = await load();
    const r = reconcile({ ...BASE, actualProviderCostMicros: 8000 });
    expect(r.state).toBe("partially_settled");
    expect(r.actualGrossMarginBps).toBeNull();
  });

  it("computes realised margin only when fully settled", async () => {
    const { reconcile } = await load();
    const r = reconcile({ ...BASE, actualProviderCostMicros: 8000, actualCarrierCostMicros: 600 });
    expect(r.state).toBe("settled");
    expect(r.effectiveCostMicros).toBe(8600);
    expect(r.actualContributionMicros).toBe(34091 - 8600);
    expect(r.actualGrossMarginBps).not.toBeNull();
    expect(r.actualGrossMarginBps).toBeGreaterThan(0);
  });

  it("surfaces a loss as a negative contribution rather than hiding it", async () => {
    const { reconcile } = await load();
    const r = reconcile({
      ...BASE,
      customerRevenueMicros: 5000,
      actualProviderCostMicros: 9000,
      actualCarrierCostMicros: 0,
    });
    expect(r.actualContributionMicros).toBeLessThan(0);
  });

  it("validates money inputs and currency", async () => {
    const { reconcile } = await load();
    expect(() => reconcile({ ...BASE, currency: "usd" })).toThrow();
    expect(() => reconcile({ ...BASE, estimatedProviderCostMicros: -1 })).toThrow();
    expect(() => reconcile({ ...BASE, customerRevenueMicros: 1.5 })).toThrow();
  });
});
