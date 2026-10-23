import { createHmac } from "node:crypto";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Billing, from the outside in.
 *
 * The database proves the money rules — `supabase/tests/billing_sms_credit_test.sql`
 * performs every one of them, including fifty redeliveries of one invoice and
 * an out-of-order cancellation. What is tested here is the boundary: that an
 * unsigned webhook writes nothing at all, that a redelivery does no work, that
 * an event whose customer we cannot place is left visible rather than dropped,
 * and that no path lets a browser grant itself a plan.
 */

const WEBHOOK_SECRET = "whsec_test_secret";

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

const rpcCalls: RpcCall[] = [];
const rpcResults = new Map<string, { data: unknown; error: unknown }>();
let tableRows = new Map<string, unknown[]>();

function queryBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "order", "limit", "eq", "neq", "is", "in", "not"]) {
    builder[method] = chain;
  }
  builder["maybeSingle"] = () =>
    Promise.resolve({ data: tableRows.get(table)?.[0] ?? null, error: null });
  builder["then"] = (resolve: (v: { data: unknown; error: unknown }) => unknown) =>
    resolve({ data: tableRows.get(table) ?? [], error: null });
  return builder;
}

function fakeClient() {
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "user-1" } }, error: null }) },
    from: (table: string) => ({
      select: () => queryBuilder(table),
      update: () => queryBuilder(table),
      insert: () => queryBuilder(table),
    }),
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(rpcResults.get(name) ?? { data: null, error: null });
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({ createClient: () => fakeClient() }));

const ORG = "11111111-1111-1111-1111-111111111111";

function stripeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_test1",
    type: "customer.subscription.updated",
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: "sub_test1",
        customer: "cus_test1",
        status: "active",
        cancel_at_period_end: false,
        trial_end: null,
        metadata: { plan_id: "starter" },
        items: {
          data: [
            {
              price: { id: "price_starter_test" },
              current_period_start: 1_700_000_000,
              current_period_end: 1_702_592_000,
            },
          ],
        },
      },
    },
    ...overrides,
  };
}

function signedRequest(body: string, secret = WEBHOOK_SECRET) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  return new Request("http://localhost:3000/api/v1/webhooks/stripe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": `t=${timestamp},v1=${signature}`,
    },
    body,
  });
}

beforeAll(() => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  process.env.PUBLIC_FRONTEND_URL = "https://app.reviewboost.test";
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
  process.env.STRIPE_SECRET_KEY = "sk_test_123";
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.STRIPE_PRICE_STARTER = "price_starter_test";
  process.env.STRIPE_PRICE_GROWTH = "price_growth_test";
  process.env.STRIPE_PRICE_PRO = "price_pro_test";
});

beforeEach(() => {
  rpcCalls.length = 0;
  rpcResults.clear();
  rpcResults.set("rpc_stripe_event_record", { data: "stored", error: null });
  rpcResults.set("rpc_billing_apply_subscription", { data: "applied", error: null });
  rpcResults.set("rpc_billing_org_for_customer", { data: ORG, error: null });
  tableRows = new Map();
});

describe("the webhook sink", () => {
  it("writes nothing at all for an unsigned request", async () => {
    const { POST } = await import("@/app/api/v1/webhooks/stripe/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/webhooks/stripe", {
        method: "POST",
        body: JSON.stringify(stripeEvent()),
      }) as never,
    );

    expect(response.status).toBe(400);
    expect(rpcCalls).toEqual([]);
  });

  it("writes nothing at all for a wrongly-signed request", async () => {
    const body = JSON.stringify(stripeEvent());
    const { POST } = await import("@/app/api/v1/webhooks/stripe/route");
    const response = await POST(signedRequest(body, "whsec_someone_elses_secret") as never);

    expect(response.status).toBe(400);
    // The inbox must not be fillable by anyone who can reach the URL.
    expect(rpcCalls).toEqual([]);
  });

  it("stores a verified event and applies it", async () => {
    const body = JSON.stringify(stripeEvent());
    const { POST } = await import("@/app/api/v1/webhooks/stripe/route");
    const response = await POST(signedRequest(body) as never);

    expect(response.status).toBe(200);
    expect(rpcCalls[0]?.name).toBe("rpc_stripe_event_record");
    expect(rpcCalls.some(({ name }) => name === "rpc_billing_apply_subscription")).toBe(true);
    expect(rpcCalls.some(({ name }) => name === "rpc_stripe_event_complete")).toBe(true);
  });

  it("does no work at all for a redelivered event", async () => {
    rpcResults.set("rpc_stripe_event_record", { data: "duplicate", error: null });
    const body = JSON.stringify(stripeEvent());
    const { POST } = await import("@/app/api/v1/webhooks/stripe/route");
    const response = await POST(signedRequest(body) as never);

    expect(response.status).toBe(200);
    expect(rpcCalls.some(({ name }) => name === "rpc_billing_apply_subscription")).toBe(false);
    expect(rpcCalls.some(({ name }) => name === "rpc_stripe_event_complete")).toBe(false);
  });

  it("retries an event that was recorded but never processed", async () => {
    // Stripe retries for days so that a transient failure does not cost the
    // event. If the inbox called that retry a duplicate, a subscription change
    // or a month's allowance would be lost with nothing to replay it.
    rpcResults.set("rpc_stripe_event_record", { data: "stored", error: null });
    rpcResults.set("rpc_billing_org_for_customer", { data: ORG, error: null });
    rpcResults.set("rpc_billing_apply_subscription", { data: "applied", error: null });

    const { receiveStripeWebhook } = await import("@/lib/server/billing-service");
    const outcome = await receiveStripeWebhook(stripeEvent({ id: "evt_retry" }) as never);

    expect(outcome.outcome).toBe("applied");
    expect(rpcCalls.some(({ name }) => name === "rpc_billing_apply_subscription")).toBe(true);
    expect(rpcCalls.some(({ name }) => name === "rpc_stripe_event_complete")).toBe(true);
  });

  it("returns a retryable 500 for an unlinked Stripe customer", async () => {
    rpcResults.set("rpc_billing_org_for_customer", { data: null, error: null });
    const body = JSON.stringify(stripeEvent());
    const { POST } = await import("@/app/api/v1/webhooks/stripe/route");
    const response = await POST(signedRequest(body) as never);

    // Do not acknowledge an unprocessed event: Stripe must retry when the
    // organization link becomes available.
    expect(response.status).toBe(500);
    expect(rpcCalls.some(({ name }) => name === "rpc_stripe_event_complete")).toBe(false);
    expect(rpcCalls.some(({ name }) => name === "rpc_stripe_event_fail")).toBe(true);
  });

  it("does not acknowledge an event when recording completion fails", async () => {
    rpcResults.set("rpc_stripe_event_complete", { data: null, error: { message: "database write failed" } });
    const { POST } = await import("@/app/api/v1/webhooks/stripe/route");
    const response = await POST(signedRequest(JSON.stringify(stripeEvent())) as never);

    expect(response.status).toBe(500);
    expect(rpcCalls.some(({ name }) => name === "rpc_stripe_event_fail")).toBe(true);
  });

  it("still returns 500 if even recording the webhook failure fails", async () => {
    rpcResults.set("rpc_stripe_event_complete", { data: null, error: { message: "database write failed" } });
    rpcResults.set("rpc_stripe_event_fail", { data: null, error: { message: "failure ledger unavailable" } });
    const { POST } = await import("@/app/api/v1/webhooks/stripe/route");
    const response = await POST(signedRequest(JSON.stringify(stripeEvent())) as never);

    expect(response.status).toBe(500);
  });

  it("completes the cancellation that follows an account deletion", async () => {
    // The deletion route cancels in Stripe and the cascade removes the
    // customer row, so this event can never be placed. Left unprocessed, it
    // held /internal/health at 503 forever, because Stripe got a 200 and never
    // sent it again.
    rpcResults.set("rpc_billing_org_for_customer", { data: null, error: null });
    const event = stripeEvent({ type: "customer.subscription.deleted" });
    (event.data.object as { status: string }).status = "canceled";
    const { POST } = await import("@/app/api/v1/webhooks/stripe/route");
    const response = await POST(signedRequest(JSON.stringify(event)) as never);

    expect(response.status).toBe(200);
    expect(rpcCalls.some(({ name }) => name === "rpc_stripe_event_complete")).toBe(true);
    expect(rpcCalls.some(({ name }) => name === "rpc_stripe_event_fail")).toBe(false);
    expect(rpcCalls.some(({ name }) => name === "rpc_billing_apply_subscription")).toBe(false);
  });
});

describe("what each event does", () => {
  it("passes the Stripe status through rather than deciding one", async () => {
    const { applyStripeEvent } = await import("@/lib/server/billing-service");
    await applyStripeEvent(stripeEvent({ type: "customer.subscription.updated" }) as never);

    const call = rpcCalls.find(({ name }) => name === "rpc_billing_apply_subscription");
    expect(call?.args["p_stripe_status"]).toBe("active");
    expect(call?.args["p_plan_id"]).toBe("starter");
    // The event's own timestamp travels with it: that is what makes an
    // out-of-order delivery detectable at the database.
    expect(call?.args["p_event_created"]).toBeTypeOf("string");
  });

  it("never takes a plan from subscription metadata", async () => {
    // The old hole: a price nobody sells, with `plan_id=pro` written into the
    // subscription's metadata. The plan sent to the database must be null,
    // leaving the database's price map to refuse it.
    const { applyStripeEvent } = await import("@/lib/server/billing-service");
    const event = stripeEvent();
    const subscription = event.data.object as Record<string, unknown>;
    subscription["metadata"] = { plan_id: "pro" };
    subscription["items"] = {
      data: [{ price: { id: "price_not_ours" }, current_period_start: 1, current_period_end: 2 }],
    };

    await applyStripeEvent(event as never);

    const call = rpcCalls.find(({ name }) => name === "rpc_billing_apply_subscription");
    expect(call?.args["p_stripe_price_id"]).toBe("price_not_ours");
    expect(call?.args["p_plan_id"]).toBeNull();
  });

  it("fails an unmapped price loudly, so Stripe retries and an operator sees it", async () => {
    rpcResults.set("rpc_billing_apply_subscription", {
      data: null,
      error: { message: "unknown_price", code: "P0001" },
    });
    const { receiveStripeWebhook } = await import("@/lib/server/billing-service");
    const { logger } = await import("@/lib/server/logger");
    const errorSpy = vi.spyOn(logger, "error");

    await expect(receiveStripeWebhook(stripeEvent() as never)).rejects.toBeTruthy();

    expect(rpcCalls.some(({ name }) => name === "rpc_stripe_event_complete")).toBe(false);
    const failed = rpcCalls.find(({ name }) => name === "rpc_stripe_event_fail");
    expect(String(failed?.args["p_error"])).toContain("unknown_price");
    expect(errorSpy).toHaveBeenCalledWith(
      "billing.price_unmapped",
      expect.objectContaining({ reason: "unknown_price", priceId: "price_starter_test" }),
    );
    errorSpy.mockRestore();
  });

  it("reports a stale event as stale rather than as applied", async () => {
    rpcResults.set("rpc_billing_apply_subscription", { data: "stale", error: null });
    const { applyStripeEvent } = await import("@/lib/server/billing-service");

    expect(await applyStripeEvent(stripeEvent() as never)).toBe("stale");
  });

  it("mints monthly SMS only from a paid invoice", async () => {
    rpcResults.set("rpc_billing_apply_invoice_paid", { data: "granted", error: null });
    const { applyStripeEvent } = await import("@/lib/server/billing-service");

    await applyStripeEvent({
      id: "evt_inv",
      type: "invoice.paid",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: "in_test1",
          customer: "cus_test1",
          amount_paid: 4900,
          lines: {
            data: [
              {
                price: { id: "price_starter_test" },
                period: { start: 1_700_000_000, end: 1_702_592_000 },
              },
            ],
          },
        },
      },
    } as never);

    const call = rpcCalls.find(({ name }) => name === "rpc_billing_apply_invoice_paid");
    expect(call?.args["p_invoice_id"]).toBe("in_test1");
    // The price travels, not a plan name: the database maps it.
    expect(call?.args["p_stripe_price_id"]).toBe("price_starter_test");
    expect(call?.args).not.toHaveProperty("p_plan_id");
    expect(call?.args["p_amount_paid"]).toBe(4900);
  });

  it("reads the price from the pinned API version's invoice shape", async () => {
    // `2026-08-26.dahlia` moved the price off the line item and into
    // `pricing.price_details`. Reading only the old field does not throw — it
    // quietly hands the grant no plan, and a business that paid gets no SMS.
    rpcResults.set("rpc_billing_apply_invoice_paid", { data: "granted", error: null });
    const { applyStripeEvent } = await import("@/lib/server/billing-service");

    await applyStripeEvent({
      id: "evt_inv_dahlia",
      type: "invoice.paid",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: "in_dahlia",
          customer: "cus_test1",
          amount_paid: 7900,
          lines: {
            data: [
              {
                pricing: {
                  type: "price_details",
                  price_details: { price: "price_growth_test", product: "prod_growth" },
                },
                period: { start: 1_700_000_000, end: 1_702_592_000 },
              },
            ],
          },
        },
      },
    } as never);

    const call = rpcCalls.find(({ name }) => name === "rpc_billing_apply_invoice_paid");
    expect(call?.args["p_invoice_id"]).toBe("in_dahlia");
    expect(call?.args["p_stripe_price_id"]).toBe("price_growth_test");
  });

  it("reads the new plan's period line, not the proration that comes first", async () => {
    // The renewal after Starter → Growth. Line 0 is the credit for unused
    // Starter time, dated to the period that just ended. Reading it minted
    // Starter's allowance, already expired, for a business paying for Growth.
    rpcResults.set("rpc_billing_apply_invoice_paid", { data: "granted", error: null });
    const { applyStripeEvent } = await import("@/lib/server/billing-service");

    await applyStripeEvent({
      id: "evt_inv_upgrade",
      type: "invoice.paid",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: "in_upgrade",
          customer: "cus_test1",
          amount_paid: 9100,
          lines: {
            data: [
              {
                parent: {
                  type: "subscription_item_details",
                  subscription_item_details: { proration: true },
                },
                pricing: { type: "price_details", price_details: { price: "price_starter_test" } },
                period: { start: 1_700_500_000, end: 1_702_592_000 },
              },
              {
                parent: {
                  type: "subscription_item_details",
                  subscription_item_details: { proration: true },
                },
                pricing: { type: "price_details", price_details: { price: "price_growth_test" } },
                period: { start: 1_700_500_000, end: 1_702_592_000 },
              },
              {
                parent: {
                  type: "subscription_item_details",
                  subscription_item_details: { proration: false },
                },
                pricing: { type: "price_details", price_details: { price: "price_growth_test" } },
                period: { start: 1_702_592_000, end: 1_705_270_400 },
              },
            ],
          },
        },
      },
    } as never);

    const call = rpcCalls.find(({ name }) => name === "rpc_billing_apply_invoice_paid");
    expect(call?.args["p_stripe_price_id"]).toBe("price_growth_test");
    expect(call?.args["p_period_start"]).toBe(new Date(1_702_592_000 * 1000).toISOString());
    expect(call?.args["p_period_end"]).toBe(new Date(1_705_270_400 * 1000).toISOString());
  });

  it("mints nothing from an invoice that is only prorations", async () => {
    rpcResults.set("rpc_billing_apply_invoice_paid", { data: "no_plan", error: null });
    const { applyStripeEvent } = await import("@/lib/server/billing-service");

    await applyStripeEvent({
      id: "evt_inv_proration_only",
      type: "invoice.paid",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: "in_proration_only",
          customer: "cus_test1",
          amount_paid: 1500,
          lines: {
            data: [
              {
                parent: {
                  type: "subscription_item_details",
                  subscription_item_details: { proration: true },
                },
                pricing: { type: "price_details", price_details: { price: "price_growth_test" } },
                period: { start: 1_700_500_000, end: 1_702_592_000 },
              },
            ],
          },
        },
      },
    } as never);

    const call = rpcCalls.find(({ name }) => name === "rpc_billing_apply_invoice_paid");
    // No period line: no price and no period, which the database answers
    // with `no_plan` rather than a grant.
    expect(call?.args["p_stripe_price_id"]).toBeNull();
    expect(call?.args["p_period_end"]).toBeNull();
  });

  it("mints nothing on a failed payment", async () => {
    const { applyStripeEvent } = await import("@/lib/server/billing-service");
    const outcome = await applyStripeEvent({
      id: "evt_failed",
      type: "invoice.payment_failed",
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: "in_failed", customer: "cus_test1" } },
    } as never);

    expect(outcome).toBe("ignored");
    expect(rpcCalls.some(({ name }) => name === "rpc_billing_apply_invoice_paid")).toBe(false);
  });

  it("ignores an event type it does not handle instead of guessing", async () => {
    const { applyStripeEvent } = await import("@/lib/server/billing-service");
    const outcome = await applyStripeEvent({
      id: "evt_other",
      type: "charge.succeeded",
      created: Math.floor(Date.now() / 1000),
      data: { object: {} },
    } as never);

    expect(outcome).toBe("ignored");
    expect(rpcCalls.filter(({ name }) => name.startsWith("rpc_billing_"))).toEqual([]);
  });
});

describe("what the owner is told", () => {
  it("reports the backend's state and never invents a plan", async () => {
    tableRows.set("entitlement_snapshots", [
      {
        plan_id: null,
        status: "suspended",
        cancel_at_period_end: false,
        trial_ends_at: null,
        current_period_end: null,
      },
    ]);
    rpcResults.set("rpc_sms_balance", {
      data: [{ monthly: 0, purchased: 0, total: 0 }],
      error: null,
    });

    const { readBillingState } = await import("@/lib/server/billing-service");
    const { createClient } = await import("@supabase/supabase-js");
    const state = await readBillingState(
      { db: createClient("", "") as never, userId: "u" },
      ORG,
      "req-1",
    );

    expect(state.planId).toBeNull();
    expect(state.status).toBe("suspended");
    expect(state.smsBalance).toEqual({ monthly: 0, purchased: 0, total: 0 });
  });

  it("fails closed when the SMS credit balance lookup fails", async () => {
    tableRows.set("entitlement_snapshots", [
      {
        plan_id: "starter",
        status: "active",
        cancel_at_period_end: false,
        trial_ends_at: null,
        current_period_end: null,
      },
    ]);
    rpcResults.set("rpc_sms_balance", { data: null, error: { message: "database offline" } });

    const { readBillingState } = await import("@/lib/server/billing-service");
    const { createClient } = await import("@supabase/supabase-js");

    await expect(
      readBillingState({ db: createClient("", "") as never, userId: "u" }, ORG, "req-balance-error"),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("carries the locked prices and limits rather than letting a page hardcode them", async () => {
    tableRows.set("entitlement_snapshots", [
      {
        plan_id: "growth",
        status: "active",
        cancel_at_period_end: true,
        trial_ends_at: null,
        current_period_end: "2026-10-15T00:00:00Z",
      },
    ]);
    rpcResults.set("rpc_sms_balance", {
      data: [{ monthly: 500, purchased: 42, total: 542 }],
      error: null,
    });

    const { readBillingState } = await import("@/lib/server/billing-service");
    const { createClient } = await import("@supabase/supabase-js");
    const state = await readBillingState(
      { db: createClient("", "") as never, userId: "u" },
      ORG,
      "req-2",
    );

    expect(state.plans.growth).toEqual({
      locations: 2,
      tags: 8,
      monthlySmsSegments: 500,
      priceUsdCents: 7900,
    });
    expect(state.cancelAtPeriodEnd).toBe(true);
    expect(state.smsBalance.purchased).toBe(42);
  });
});
