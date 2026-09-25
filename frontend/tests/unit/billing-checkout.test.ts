import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Checkout, and who gets a trial.
 *
 * Starter is the only plan with a trial: seven days, card required. Growth and
 * Pro are charged at checkout. A business that has subscribed before gets no
 * second trial by cancelling and checking out again. Stripe decides whether a
 * charge happens from `trial_period_days`, so that field is what is asserted.
 */

const ORG = "11111111-1111-1111-1111-111111111111";

let subscriptionRow: { stripe_status: string } | null = null;
const sessionsCreate = vi.fn();

function builder(row: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) chain[method] = () => chain;
  chain["maybeSingle"] = () => Promise.resolve({ data: row, error: null });
  return chain;
}

vi.mock("@/lib/server/stripe", () => ({
  stripeClient: () => ({ checkout: { sessions: { create: sessionsCreate } } }),
}));

vi.mock("@/lib/server/supabase", () => ({
  serviceRoleClient: () => ({
    from: () => builder({ stripe_customer_id: "cus_existing" }),
  }),
}));

function context() {
  return {
    userId: "user-1",
    db: { from: () => builder(subscriptionRow) },
  } as never;
}

beforeAll(() => {
  process.env.PUBLIC_FRONTEND_URL = "https://app.reviewboost.test";
  process.env.STRIPE_PRICE_STARTER = "price_starter_test";
  process.env.STRIPE_PRICE_GROWTH = "price_growth_test";
  process.env.STRIPE_PRICE_PRO = "price_pro_test";
});

beforeEach(() => {
  subscriptionRow = null;
  sessionsCreate.mockReset();
  sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.test/s" });
});

async function checkout(planId: "starter" | "growth" | "pro") {
  const { createCheckoutSession } = await import("@/lib/server/billing-service");
  await createCheckoutSession(context(), ORG, planId, "req-1");
  const [params] = sessionsCreate.mock.calls[0] as [Record<string, unknown>];
  return params as {
    payment_method_collection: string;
    subscription_data: { trial_period_days?: number; metadata: Record<string, string> };
  };
}

describe("who gets a trial at checkout", () => {
  it("gives Starter seven days, with a card required", async () => {
    const params = await checkout("starter");
    expect(params.subscription_data.trial_period_days).toBe(7);
    expect(params.payment_method_collection).toBe("always");
  });

  it.each(["growth", "pro"] as const)("charges %s immediately, with no trial", async (plan) => {
    const params = await checkout(plan);
    expect(params.subscription_data).not.toHaveProperty("trial_period_days");
    expect(params.payment_method_collection).toBe("always");
    expect(params.subscription_data.metadata).toMatchObject({ org_id: ORG, plan_id: plan });
  });

  it("gives no second trial to a business that has subscribed before", async () => {
    subscriptionRow = { stripe_status: "canceled" };
    const params = await checkout("starter");
    expect(params.subscription_data).not.toHaveProperty("trial_period_days");
  });

  it("refuses a second subscription while one is running", async () => {
    subscriptionRow = { stripe_status: "trialing" };
    const { createCheckoutSession } = await import("@/lib/server/billing-service");
    await expect(createCheckoutSession(context(), ORG, "growth", "req-2")).rejects.toMatchObject({
      status: 409,
    });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });
});

describe("one source of truth for the trial", () => {
  it("puts the trial on Starter only, in the catalog every surface reads", async () => {
    const { PLAN_CATALOG } = await import("@/lib/owner/plan-catalog");
    const { PUBLIC_PLANS, TRIAL } = await import("@/features/public/pricing-plans");
    const { TRIAL_DAYS, trialDaysFor } = await import("@/lib/server/entitlements");

    expect(PLAN_CATALOG.starter.trialDays).toBe(7);
    expect(PLAN_CATALOG.growth.trialDays).toBe(0);
    expect(PLAN_CATALOG.pro.trialDays).toBe(0);
    expect(PUBLIC_PLANS.map((p) => [p.id, p.trialDays])).toEqual([
      ["starter", 7],
      ["growth", 0],
      ["pro", 0],
    ]);
    expect(TRIAL.days).toBe(TRIAL_DAYS);
    expect(trialDaysFor("growth")).toBe(0);
  });
});
