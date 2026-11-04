import { describe, expect, it } from "vitest";

import { accountView, balanceView, includedView, planLabel, TRIAL_INCLUDES } from "../billing-view";
import type { BillingState } from "../use-billing";

function billing(overrides: Partial<BillingState>): BillingState {
  return {
    planId: "starter",
    status: "active",
    cancelAtPeriodEnd: false,
    trialEndsAt: null,
    currentPeriodEnd: null,
    smsBalance: { monthly: 0, purchased: 0, total: 0 },
    plans: {
      starter: { locations: 1, tags: 3, monthlySmsSegments: 150, priceUsdCents: 4900 },
      growth: { locations: 2, tags: 8, monthlySmsSegments: 500, priceUsdCents: 7900 },
      pro: { locations: 5, tags: 25, monthlySmsSegments: 1500, priceUsdCents: 12900 },
    },
    ...overrides,
  };
}

describe("the account view invents nothing", () => {
  it("is loading until the backend answers — never a default plan", () => {
    expect(accountView(null, null)).toEqual({ kind: "loading" });
  });

  it("reports the failure instead of a plan when the backend cannot answer", () => {
    expect(accountView(null, "network down")).toEqual({
      kind: "error",
      message: "network down",
    });
  });

  it("says 'No plan' rather than naming one the business does not have", () => {
    const view = accountView(billing({ planId: null, status: "suspended" }), null);
    expect(view).toMatchObject({ kind: "ready", planName: "No plan yet" });
    expect(accountView(billing({ planId: null, status: "cancelled" }), null)).toMatchObject({ planName: "No plan" });
    expect(planLabel(null)).toBe("No plan");
  });

  it("does not call a business that never had a plan 'Suspended'", () => {
    // The server answers "suspended" with no plan for a brand-new business.
    const view = accountView(billing({ planId: null, status: "suspended" }), null);
    expect(view).toMatchObject({
      kind: "ready",
      planName: "No plan yet",
      statusTitle: "",
      statusBody: "Your Tags are off until this business has a plan.",
      serving: false,
    });
    // A real suspension, of a plan that was running, still says so.
    expect(accountView(billing({ status: "suspended" }), null)).toMatchObject({ statusTitle: "Suspended" });
  });

  it("keeps a past-due business reading as still serving customers", () => {
    // A bank's fraud heuristic must not send an owner off to replace hardware
    // that is working perfectly well.
    const view = accountView(billing({ status: "past_due" }), null);
    expect(view).toMatchObject({ kind: "ready", serving: true, needsAttention: true });
  });

  it("says plainly when the Tags have stopped, and that nothing was deleted", () => {
    for (const status of ["cancelled", "suspended"] as const) {
      const view = accountView(billing({ status }), null);
      expect(view, status).toMatchObject({ kind: "ready", serving: false });
      if (view.kind === "ready") {
        expect(view.statusBody, status).toMatch(/nothing has been deleted/i);
      }
    }
  });

  it("treats cancelling-at-period-end as still running", () => {
    const view = accountView(
      billing({ status: "active", cancelAtPeriodEnd: true, currentPeriodEnd: "2026-10-01T00:00:00Z" }),
      null,
    );
    expect(view).toMatchObject({ kind: "ready", statusTitle: "Ending soon", serving: true });
  });
});

describe("what the plan includes", () => {
  it("is the trial's own allowance during a trial: one place, one Tag, as the website says", () => {
    expect(includedView(billing({ status: "trialing", planId: "starter" }))).toEqual({
      label: "During your trial",
      ...TRIAL_INCLUDES,
    });
    expect(TRIAL_INCLUDES).toEqual({ locations: 1, tags: 1, texts: 0 });
  });

  it("is the plan's for a running plan, paid up or retrying a card", () => {
    for (const status of ["active", "past_due"] as const) {
      expect(includedView(billing({ status, planId: "growth" })), status).toEqual({
        label: "Includes",
        locations: 2,
        tags: 8,
        texts: 500,
      });
    }
  });

  it("lists nothing for a plan that is not running, or before the server answers", () => {
    expect(includedView(null)).toBeNull();
    expect(includedView(billing({ status: "suspended", planId: null }))).toBeNull();
    expect(includedView(billing({ status: "cancelled" }))).toBeNull();
  });
});

describe("the balance view", () => {
  it("does not show zero before zero is known", () => {
    // A trial really does have none, so "loading" and "you have none" are
    // different answers and must not be conflated.
    expect(balanceView(null)).toEqual({ kind: "loading" });
  });

  it("reports the ledger's split and whether anything can be sent", () => {
    expect(balanceView({ monthly: 0, purchased: 0, total: 0 })).toEqual({
      kind: "ready",
      total: 0,
      monthly: 0,
      purchased: 0,
      canSend: false,
    });
    expect(balanceView({ monthly: 37, purchased: 500, total: 537 })).toEqual({
      kind: "ready",
      total: 537,
      monthly: 37,
      purchased: 500,
      canSend: true,
    });
  });
});

/**
 * App Store 3.1.3(f): a free companion to a plan bought on the web must not
 * sell inside the app or point at where to pay. The account copy states
 * facts about the plan and stops.
 */
describe("account copy stays purchase-free", () => {
  const statuses = ["trialing", "active", "past_due", "cancelled", "suspended"] as const;

  it("never tells the owner to pay, subscribe, upgrade or go to the web", () => {
    for (const status of statuses) {
      for (const [cancelAtPeriodEnd, planId] of [
        [false, "starter"],
        [true, "starter"],
        [false, null],
      ] as const) {
        const view = accountView(
          billing({ status, cancelAtPeriodEnd, planId, currentPeriodEnd: "2026-10-26T00:00:00Z" }),
          null,
        );
        if (view.kind !== "ready") throw new Error(status);
        const copy = `${view.statusTitle} ${view.statusBody}`;
        expect(copy, status).not.toMatch(
          /subscribe|upgrade|buy|purchase|on the web|website|update your card|pricing/i,
        );
      }
    }
  });
});
