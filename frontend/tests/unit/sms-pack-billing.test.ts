import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Text packs, from the Stripe side.
 *
 * `supabase/tests/sms_pack_money_test.sql` proves the ledger: that a refund
 * takes back only unspent credit, never makes a balance negative, and turns
 * spent-and-refunded credit into a review. What is proved here is that every
 * Stripe event that can move money on a pack reaches that ledger with the
 * right numbers, that events which are not about a pack do not, and that no
 * owner is sent to pay a price the database would refuse to credit.
 */

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

const rpcCalls: RpcCall[] = [];
type RpcResult = { data: unknown; error: unknown };
/** A fixed answer, or one computed per call (for "the first call fails"). */
const rpcResults = new Map<string, RpcResult | ((args: Record<string, unknown>) => RpcResult)>();
let tableRows = new Map<string, unknown[]>();

function queryBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "order", "limit", "eq", "neq", "is", "in", "not"]) {
    builder[method] = chain;
  }
  builder["maybeSingle"] = () =>
    Promise.resolve({ data: tableRows.get(table)?.[0] ?? null, error: null });
  return builder;
}

function fakeClient() {
  return {
    from: (table: string) => ({ select: () => queryBuilder(table) }),
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      const result = rpcResults.get(name);
      return Promise.resolve(
        typeof result === "function" ? result(args) : (result ?? { data: null, error: null }),
      );
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({ createClient: () => fakeClient() }));

const ORG = "11111111-1111-1111-1111-111111111111";

const stripeCalls: Array<{ method: string; args: unknown[] }> = [];
let paymentIntentMetadata: Record<string, string> = {};
let listedSessions: unknown[] = [];
/** What Stripe says each configured price is. */
let stripePrices: Record<string, Record<string, unknown>> = {};
/** When set, Stripe cannot be reached to open a checkout. */
let checkoutFails = false;
/** Events Stripe has kept (for reconciliation's replay pass). */
let listedEvents: unknown[] = [];
/** When set, Stripe does not answer reconciliation's listing. */
let listingFails = false;

const fakeStripe = {
  paymentIntents: {
    retrieve: (...args: unknown[]) => {
      stripeCalls.push({ method: "paymentIntents.retrieve", args });
      return Promise.resolve({ id: args[0], customer: "cus_pack", metadata: paymentIntentMetadata });
    },
  },
  prices: {
    retrieve: (...args: unknown[]) => {
      stripeCalls.push({ method: "prices.retrieve", args });
      return Promise.resolve(stripePrices[args[0] as string] ?? { active: false });
    },
  },
  customers: {
    create: () => Promise.resolve({ id: "cus_new" }),
  },
  checkout: {
    sessions: {
      create: (...args: unknown[]) => {
        stripeCalls.push({ method: "checkout.sessions.create", args });
        if (checkoutFails) return Promise.reject(new Error("connect ECONNREFUSED api.stripe.com"));
        return Promise.resolve({ url: "https://checkout.stripe.test/pack" });
      },
      list: (...args: unknown[]) => {
        stripeCalls.push({ method: "checkout.sessions.list", args });
        return {
          async *[Symbol.asyncIterator]() {
            if (listingFails) throw new Error("Request timed out");
            for (const session of listedSessions) yield session;
          },
        };
      },
    },
  },
  events: {
    list: (...args: unknown[]) => {
      stripeCalls.push({ method: "events.list", args });
      return {
        async *[Symbol.asyncIterator]() {
          for (const item of listedEvents) yield item;
        },
      };
    },
  },
  disputes: {
    list: () => Promise.resolve({ data: [{ id: "du_1", status: "lost", payment_intent: "pi_pack1" }] }),
  },
};

function event(type: string, object: Record<string, unknown>, id = `evt_${type}`) {
  return { id, type, created: 1_790_000_000, data: { object } };
}

function paidPackSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_test_pack1",
    mode: "payment",
    payment_status: "paid",
    customer: "cus_pack",
    payment_intent: "pi_pack1",
    amount_total: 400,
    currency: "usd",
    metadata: { org_id: ORG, kind: "sms_pack", pack_id: "pack_50" },
    ...overrides,
  };
}

function oneTimePrice(unitAmount: number, overrides: Record<string, unknown> = {}) {
  return { active: true, type: "one_time", currency: "usd", unit_amount: unitAmount, ...overrides };
}

beforeAll(async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  process.env.PUBLIC_FRONTEND_URL = "https://app.reviewboost.test";
  process.env.STRIPE_SECRET_KEY = "sk_test_123";
  process.env.STRIPE_PRICE_STARTER = "price_starter_test";
  process.env.STRIPE_PRICE_GROWTH = "price_growth_test";
  process.env.STRIPE_PRICE_PRO = "price_pro_test";
  process.env.STRIPE_PRICE_SMS_PACK_50 = "price_pack50_test";
  process.env.STRIPE_PRICE_SMS_PACK_200 = "price_pack200_test";
  process.env.STRIPE_PRICE_SMS_PACK_500 = "price_pack500_test";

  const { __setStripeClientForTests } = await import("@/lib/server/stripe");
  __setStripeClientForTests(fakeStripe as never);
});

beforeEach(async () => {
  rpcCalls.length = 0;
  stripeCalls.length = 0;
  rpcResults.clear();
  tableRows = new Map();
  paymentIntentMetadata = {};
  listedSessions = [];
  listedEvents = [];
  listingFails = false;
  checkoutFails = false;
  stripePrices = {
    price_pack50_test: oneTimePrice(400),
    price_pack200_test: oneTimePrice(1600),
    price_pack500_test: oneTimePrice(4000),
  };
  const { __resetPackPriceChecksForTests } = await import("@/lib/server/billing-service");
  __resetPackPriceChecksForTests();

  rpcResults.set("rpc_stripe_event_record", { data: "stored", error: null });
  rpcResults.set("rpc_billing_org_for_customer", { data: ORG, error: null });
  rpcResults.set("rpc_billing_customer_for_org", { data: "cus_pack", error: null });
  rpcResults.set("rpc_billing_apply_pack_payment", { data: "granted", error: null });
  rpcResults.set("rpc_billing_pack_org", { data: ORG, error: null });
  rpcResults.set("rpc_billing_apply_pack_refund", {
    data: [{ outcome: "applied", outstanding_segments: 0 }],
    error: null,
  });
  rpcResults.set("rpc_billing_apply_pack_dispute", {
    data: [{ outcome: "applied", outstanding_segments: 0 }],
    error: null,
  });
  rpcResults.set("rpc_billing_org_deleted", { data: false, error: null });
});

function called(name: string): RpcCall | undefined {
  return rpcCalls.find((call) => call.name === name);
}

describe("the pack card", () => {
  it("is the same card in TypeScript and in the database that enforces it", async () => {
    const { SMS_PACKS } = await import("@/lib/server/sms-packs");
    const sql = readFileSync(
      join(process.cwd(), "..", "supabase/migrations/20261103000100_sms_pack_money.sql"),
      "utf8",
    );

    for (const [packId, pack] of Object.entries(SMS_PACKS)) {
      expect(sql).toMatch(
        new RegExp(
          `\\('${packId}',\\s+${pack.segments}::bigint,\\s+${pack.priceUsdCents}::bigint,\\s+'usd'\\)`,
        ),
      );
    }
  });

  it("is the same card the pricing page and the Billing page show", async () => {
    const { SMS_PACK_LIST } = await import("@/lib/server/sms-packs");
    const { TEXT_PACKS } = await import("@/features/public/pricing-plans");

    expect(TEXT_PACKS.map((p) => ({ id: p.id, segments: p.texts, priceUsdCents: p.price * 100 }))).toEqual(
      SMS_PACK_LIST.map((p) => ({ id: p.id, segments: p.segments, priceUsdCents: p.priceUsdCents })),
    );
  });

  it("prices every segment at the same integer rate", async () => {
    const { SMS_PACKS } = await import("@/lib/server/sms-packs");
    for (const pack of Object.values(SMS_PACKS)) {
      expect(Number.isInteger(pack.priceUsdCents)).toBe(true);
      expect(pack.priceUsdCents / pack.segments).toBe(8);
    }
  });
});

describe("a pack being paid for", () => {
  it("grants from a paid pack Checkout Session, with the amount Stripe collected", async () => {
    const { applyStripeEvent } = await import("@/lib/server/billing-service");
    const outcome = await applyStripeEvent(
      event("checkout.session.completed", paidPackSession()) as never,
    );

    expect(outcome).toBe("applied");
    expect(called("rpc_billing_apply_pack_payment")?.args).toMatchObject({
      p_org_id: ORG,
      p_payment_intent_id: "pi_pack1",
      p_checkout_session_id: "cs_test_pack1",
      p_pack_id: "pack_50",
      p_amount_cents: 400,
      p_currency: "usd",
    });
  });

  it("waits for a delayed payment method rather than granting on intent", async () => {
    const { applyStripeEvent } = await import("@/lib/server/billing-service");
    const outcome = await applyStripeEvent(
      event("checkout.session.completed", paidPackSession({ payment_status: "unpaid" })) as never,
    );

    expect(outcome).toBe("ignored");
    expect(called("rpc_billing_apply_pack_payment")).toBeUndefined();

    await applyStripeEvent(
      event("checkout.session.async_payment_succeeded", paidPackSession()) as never,
    );
    expect(called("rpc_billing_apply_pack_payment")).toBeDefined();
  });

  it("does not treat a subscription checkout as a pack", async () => {
    const { applyStripeEvent } = await import("@/lib/server/billing-service");
    const outcome = await applyStripeEvent(
      event(
        "checkout.session.completed",
        paidPackSession({ mode: "subscription", metadata: { org_id: ORG, plan_id: "starter" } }),
      ) as never,
    );

    expect(outcome).toBe("ignored");
    expect(rpcCalls.filter(({ name }) => name.startsWith("rpc_billing_apply"))).toEqual([]);
  });

  it("reports a paid pack the database refused to credit, and still marks it handled", async () => {
    rpcResults.set("rpc_billing_apply_pack_payment", { data: "amount_mismatch", error: null });
    const { receiveStripeWebhook } = await import("@/lib/server/billing-service");
    const { outcome } = await receiveStripeWebhook(
      event("checkout.session.completed", paidPackSession({ amount_total: 1 })) as never,
    );

    expect(outcome).toBe("paid_without_credit");
    // Recorded durably in the purchase ledger, where health and
    // reconciliation find it. Replaying the event would not change it.
    expect(called("rpc_stripe_event_complete")).toBeDefined();
  });

  it("refuses a session whose label names a different business from its customer", async () => {
    const { receiveStripeWebhook } = await import("@/lib/server/billing-service");
    await expect(
      receiveStripeWebhook(
        event(
          "checkout.session.completed",
          paidPackSession({ metadata: { org_id: "someone-else", kind: "sms_pack", pack_id: "pack_50" } }),
        ) as never,
      ),
    ).rejects.toThrow();

    expect(called("rpc_billing_apply_pack_payment")).toBeUndefined();
    expect(called("rpc_stripe_event_fail")).toBeDefined();
  });
});

describe("a pack being refunded or disputed", () => {
  it("carries Stripe's cumulative refunded amount to the ledger", async () => {
    const { applyStripeEvent } = await import("@/lib/server/billing-service");
    const outcome = await applyStripeEvent(
      event("charge.refunded", {
        id: "ch_1",
        payment_intent: "pi_pack1",
        customer: "cus_pack",
        amount: 400,
        amount_refunded: 400,
      }) as never,
    );

    expect(outcome).toBe("applied");
    expect(called("rpc_billing_apply_pack_refund")?.args).toMatchObject({
      p_org_id: ORG,
      p_payment_intent_id: "pi_pack1",
      p_charge_amount_cents: 400,
      p_amount_refunded_cents: 400,
    });
    // Known locally: no need to ask Stripe.
    expect(stripeCalls.some(({ method }) => method === "paymentIntents.retrieve")).toBe(false);
  });

  it("recognises a refund for a pack it has not yet seen paid, by asking Stripe", async () => {
    rpcResults.set("rpc_billing_pack_org", { data: null, error: null });
    paymentIntentMetadata = { kind: "sms_pack", org_id: ORG, pack_id: "pack_50" };

    const { applyStripeEvent } = await import("@/lib/server/billing-service");
    const outcome = await applyStripeEvent(
      event("charge.refunded", {
        id: "ch_2",
        payment_intent: "pi_early",
        amount: 400,
        amount_refunded: 400,
      }) as never,
    );

    expect(outcome).toBe("applied");
    expect(called("rpc_billing_apply_pack_refund")?.args["p_payment_intent_id"]).toBe("pi_early");
  });

  it("leaves a refund of a subscription invoice alone", async () => {
    rpcResults.set("rpc_billing_pack_org", { data: null, error: null });
    paymentIntentMetadata = {};

    const { applyStripeEvent } = await import("@/lib/server/billing-service");
    const outcome = await applyStripeEvent(
      event("charge.refunded", {
        id: "ch_sub",
        payment_intent: "pi_subscription",
        amount: 4900,
        amount_refunded: 4900,
      }) as never,
    );

    expect(outcome).toBe("ignored");
    expect(called("rpc_billing_apply_pack_refund")).toBeUndefined();
  });

  it("passes a dispute's own status through, with the event's time for ordering", async () => {
    const { applyStripeEvent } = await import("@/lib/server/billing-service");
    for (const type of [
      "charge.dispute.created",
      "charge.dispute.updated",
      "charge.dispute.closed",
      "charge.dispute.funds_withdrawn",
      "charge.dispute.funds_reinstated",
    ]) {
      rpcCalls.length = 0;
      await applyStripeEvent(
        event(type, { id: "du_1", payment_intent: "pi_pack1", charge: "ch_1", status: "won" }) as never,
      );
      expect(called("rpc_billing_apply_pack_dispute")?.args, type).toMatchObject({
        p_org_id: ORG,
        p_payment_intent_id: "pi_pack1",
        p_dispute_id: "du_1",
        p_dispute_status: "won",
        p_event_created: new Date(1_790_000_000 * 1000).toISOString(),
      });
    }
  });

  it("treats a refund, a dispute or a late payment after an account was deleted as finished", async () => {
    // The cascade took the Stripe customer link and the purchase with it.
    rpcResults.set("rpc_billing_pack_org", { data: null, error: null });
    rpcResults.set("rpc_billing_org_for_customer", { data: null, error: null });
    rpcResults.set("rpc_billing_org_deleted", { data: true, error: null });
    paymentIntentMetadata = { kind: "sms_pack", org_id: ORG, pack_id: "pack_50" };

    const { receiveStripeWebhook } = await import("@/lib/server/billing-service");
    for (const [type, object] of [
      ["charge.refunded", { id: "ch_gone", payment_intent: "pi_gone", amount: 400, amount_refunded: 400 }],
      ["charge.dispute.created", { id: "du_gone", payment_intent: "pi_gone", status: "needs_response" }],
      ["checkout.session.async_payment_succeeded", paidPackSession({ payment_intent: "pi_gone" })],
    ] as const) {
      rpcCalls.length = 0;
      const { outcome } = await receiveStripeWebhook(event(type, object as never, `evt_gone_${type}`) as never);
      expect(outcome, type).toBe("ignored");
      // Completed, so Stripe is answered 200 and stops retrying.
      expect(called("rpc_stripe_event_complete"), type).toBeDefined();
      expect(rpcCalls.filter(({ name }) => name.startsWith("rpc_billing_apply")), type).toEqual([]);
    }
  });

  it("still retries an unknown customer whose business was not deleted", async () => {
    rpcResults.set("rpc_billing_pack_org", { data: null, error: null });
    rpcResults.set("rpc_billing_org_for_customer", { data: null, error: null });
    paymentIntentMetadata = { kind: "sms_pack", org_id: ORG, pack_id: "pack_50" };

    const { applyStripeEvent } = await import("@/lib/server/billing-service");
    expect(
      await applyStripeEvent(
        event("charge.refunded", { id: "ch_x", payment_intent: "pi_x", amount: 400, amount_refunded: 400 }) as never,
      ),
    ).toBe("unknown_customer");
  });

  it("reports an out-of-order dispute event as stale", async () => {
    rpcResults.set("rpc_billing_apply_pack_dispute", {
      data: [{ outcome: "stale", outstanding_segments: 0 }],
      error: null,
    });
    const { applyStripeEvent } = await import("@/lib/server/billing-service");
    expect(
      await applyStripeEvent(
        event("charge.dispute.updated", {
          id: "du_1",
          payment_intent: "pi_pack1",
          status: "under_review",
        }) as never,
      ),
    ).toBe("stale");
  });
});

describe("buying a pack", () => {
  const context = async () => {
    const { createClient } = await import("@supabase/supabase-js");
    return { db: createClient("", "") as never, userId: "user-1" } as never;
  };

  it("is refused during a trial, which includes no texts at all", async () => {
    tableRows.set("entitlement_snapshots", [
      { status: "trialing", trial_ends_at: new Date(Date.now() + 86_400_000).toISOString() },
    ]);
    const { createPackCheckoutSession } = await import("@/lib/server/billing-service");

    await expect(createPackCheckoutSession(await context(), ORG, "pack_50", "req-1")).rejects.toMatchObject({
      status: 403,
    });
    expect(stripeCalls.some(({ method }) => method === "checkout.sessions.create")).toBe(false);
  });

  it("is refused to a business whose plan has lapsed or whose card is failing", async () => {
    const { createPackCheckoutSession } = await import("@/lib/server/billing-service");
    for (const status of ["cancelled", "suspended", "past_due"]) {
      tableRows.set("entitlement_snapshots", [{ status, trial_ends_at: null }]);
      await expect(
        createPackCheckoutSession(await context(), ORG, "pack_50", `req-${status}`),
        status,
      ).rejects.toMatchObject({ status: 403 });
    }
    expect(stripeCalls).toEqual([]);
  });

  it("is a one-off payment, labelled as a pack on the session and the PaymentIntent", async () => {
    tableRows.set("entitlement_snapshots", [{ status: "active", trial_ends_at: null }]);
    const { createPackCheckoutSession } = await import("@/lib/server/billing-service");

    const session = await createPackCheckoutSession(await context(), ORG, "pack_200", "req-3");
    expect(session.url).toContain("checkout.stripe.test");

    const [params, options] = stripeCalls.find(({ method }) => method === "checkout.sessions.create")!
      .args as [Record<string, unknown>, Record<string, unknown>];
    expect(params["mode"]).toBe("payment");
    expect(params["customer"]).toBe("cus_pack");
    expect(params["line_items"]).toEqual([{ price: "price_pack200_test", quantity: 1 }]);
    const metadata = { org_id: ORG, kind: "sms_pack", pack_id: "pack_200" };
    expect(params["metadata"]).toEqual(metadata);
    expect(params["payment_intent_data"]).toEqual({ metadata });
    expect(params["success_url"]).toBe("https://app.reviewboost.test/settings/billing?pack=complete");
    expect(params["cancel_url"]).toBe("https://app.reviewboost.test/settings/billing?pack=cancelled");
    expect(options["idempotencyKey"]).toBe(`pack:${ORG}:pack_200:req-3`);
  });

  it("is refused to a plan that is set to end, with what to do instead", async () => {
    tableRows.set("entitlement_snapshots", [{ status: "active", trial_ends_at: null, cancel_at_period_end: true }]);
    const { createPackCheckoutSession } = await import("@/lib/server/billing-service");

    await expect(createPackCheckoutSession(await context(), ORG, "pack_50", "req-end")).rejects.toMatchObject({
      status: 403,
      message: expect.stringMatching(/Turn renewal back on/),
    });
    expect(stripeCalls).toEqual([]);
  });

  it("opens a payment page that expires in about half an hour, not a day", async () => {
    tableRows.set("entitlement_snapshots", [{ status: "active", trial_ends_at: null }]);
    const { createPackCheckoutSession } = await import("@/lib/server/billing-service");
    const before = Math.floor(Date.now() / 1000);

    await createPackCheckoutSession(await context(), ORG, "pack_50", "req-exp");
    const [params] = stripeCalls.find(({ method }) => method === "checkout.sessions.create")!.args as [
      Record<string, unknown>,
    ];
    const expiresAt = params["expires_at"] as number;
    expect(expiresAt).toBeGreaterThanOrEqual(before + 30 * 60);
    expect(expiresAt).toBeLessThanOrEqual(before + 32 * 60);
  });

  it("refuses to send anyone to pay a price that is not the card's", async () => {
    tableRows.set("entitlement_snapshots", [{ status: "active", trial_ends_at: null }]);
    const { createPackCheckoutSession } = await import("@/lib/server/billing-service");

    for (const wrong of [
      oneTimePrice(500), // $5 for a $4 pack
      oneTimePrice(400, { currency: "eur" }),
      oneTimePrice(400, { type: "recurring" }), // a subscription price
      oneTimePrice(400, { active: false }),
    ]) {
      const { __resetPackPriceChecksForTests } = await import("@/lib/server/billing-service");
      __resetPackPriceChecksForTests();
      stripePrices["price_pack50_test"] = wrong;
      await expect(createPackCheckoutSession(await context(), ORG, "pack_50", "req-4")).rejects.toMatchObject({
        status: 503,
      });
    }
    expect(stripeCalls.some(({ method }) => method === "checkout.sessions.create")).toBe(false);
  });

  it("tells the owner nothing was charged when Stripe cannot be reached", async () => {
    tableRows.set("entitlement_snapshots", [{ status: "active", trial_ends_at: null }]);
    checkoutFails = true;
    const { createPackCheckoutSession } = await import("@/lib/server/billing-service");

    const failure = (await createPackCheckoutSession(await context(), ORG, "pack_50", "req-x").catch(
      (error: unknown) => error,
    )) as { status?: number; message?: string };
    expect(failure).toMatchObject({ status: 503 });
    expect(failure.message).toMatch(/nothing was charged/);
    // The cause stays in the log; the owner sees what happened and what to do.
    expect(failure.message).not.toMatch(/ECONNREFUSED|stripe\.com/);
  });

  it("checks a price once, not on every click", async () => {
    tableRows.set("entitlement_snapshots", [{ status: "active", trial_ends_at: null }]);
    const { createPackCheckoutSession } = await import("@/lib/server/billing-service");

    await createPackCheckoutSession(await context(), ORG, "pack_500", "req-5");
    await createPackCheckoutSession(await context(), ORG, "pack_500", "req-6");
    expect(stripeCalls.filter(({ method }) => method === "prices.retrieve")).toHaveLength(1);
  });
});

describe("the billing state an owner reads", () => {
  it("offers the card only to an active plan, and only with prices configured", async () => {
    const { readBillingState } = await import("@/lib/server/billing-service");
    const ctx = async () => {
      const { createClient } = await import("@supabase/supabase-js");
      return { db: createClient("", "") as never } as never;
    };
    rpcResults.set("rpc_sms_balance", { data: [{ monthly: 10, purchased: 200, total: 210 }], error: null });

    tableRows.set("entitlement_snapshots", [{ plan_id: "starter", status: "active", trial_ends_at: null }]);
    const active = await readBillingState(await ctx(), ORG, "req-7");
    expect(active.packsAvailable).toBe(true);
    expect(active.packs.map((p) => p.id)).toEqual(["pack_50", "pack_200", "pack_500"]);
    expect(active.smsBalance).toEqual({ monthly: 10, purchased: 200, total: 210 });

    tableRows.set("entitlement_snapshots", [
      { plan_id: "starter", status: "trialing", trial_ends_at: new Date(Date.now() + 86_400_000).toISOString() },
    ]);
    expect((await readBillingState(await ctx(), ORG, "req-8")).packsAvailable).toBe(false);

    tableRows.set("entitlement_snapshots", [
      { plan_id: "starter", status: "active", trial_ends_at: null, cancel_at_period_end: true },
    ]);
    expect((await readBillingState(await ctx(), ORG, "req-8b")).packsAvailable).toBe(false);

    tableRows.set("entitlement_snapshots", [{ plan_id: "starter", status: "active", trial_ends_at: null }]);
    const saved = process.env.STRIPE_PRICE_SMS_PACK_200;
    delete process.env.STRIPE_PRICE_SMS_PACK_200;
    try {
      expect((await readBillingState(await ctx(), ORG, "req-9")).packsAvailable).toBe(false);
    } finally {
      process.env.STRIPE_PRICE_SMS_PACK_200 = saved;
    }
  });
});

describe("reconciliation", () => {
  it("heals a paid pack whose webhook never landed, and records the run", async () => {
    listedSessions = [
      paidPackSession(),
      paidPackSession({ id: "cs_test_sub", mode: "subscription", metadata: {} }),
      paidPackSession({ id: "cs_test_unpaid", payment_status: "unpaid", payment_intent: "pi_unpaid" }),
    ];
    rpcResults.set("rpc_billing_pack_reconciliation_findings", { data: [], error: null });

    const { reconcileSmsPacks } = await import("@/lib/server/billing-service");
    const result = await reconcileSmsPacks({ now: new Date("2026-11-03T08:00:00Z") });

    expect(result.checked).toBe(1);
    expect(result.healed).toBe(1);
    // A heal is a webhook that failed: worth an alert even though it is fixed.
    expect(result.ok).toBe(false);
    expect(rpcCalls.filter(({ name }) => name === "rpc_billing_apply_pack_payment")).toHaveLength(1);
    expect(called("rpc_billing_record_reconciliation_run")?.args).toMatchObject({
      p_kind: "sms_packs",
      p_ok: false,
      p_checked: 1,
      p_healed: 1,
      p_findings: 0,
    });
  });

  it("is clean when every paid pack already has its credit", async () => {
    listedSessions = [paidPackSession()];
    rpcResults.set("rpc_billing_apply_pack_payment", { data: "duplicate", error: null });
    rpcResults.set("rpc_billing_pack_reconciliation_findings", { data: [], error: null });

    const { reconcileSmsPacks } = await import("@/lib/server/billing-service");
    const result = await reconcileSmsPacks();
    expect(result).toMatchObject({ ok: true, checked: 1, healed: 0, findings: 0 });
  });

  it("carries a refund and a dispute it finds on the charge", async () => {
    listedSessions = [
      paidPackSession({
        payment_intent: {
          id: "pi_pack1",
          latest_charge: {
            id: "ch_1",
            payment_intent: "pi_pack1",
            amount: 400,
            amount_refunded: 100,
            disputed: true,
          },
        },
      }),
    ];
    rpcResults.set("rpc_billing_apply_pack_payment", { data: "duplicate", error: null });
    rpcResults.set("rpc_billing_pack_reconciliation_findings", {
      data: [{ kind: "needs_review" }],
      error: null,
    });

    const { reconcileSmsPacks } = await import("@/lib/server/billing-service");
    const result = await reconcileSmsPacks();

    expect(called("rpc_billing_apply_pack_refund")?.args["p_amount_refunded_cents"]).toBe(100);
    expect(called("rpc_billing_apply_pack_dispute")?.args["p_dispute_status"]).toBe("lost");
    expect(result).toMatchObject({ ok: false, findings: 1, byKind: { needs_review: 1 } });
  });

  it("leaves a session young enough to have its webhook still in flight", async () => {
    listedSessions = [paidPackSession({ created: Math.floor(Date.now() / 1000) - 60 })];
    rpcResults.set("rpc_billing_pack_reconciliation_findings", { data: [], error: null });

    const { reconcileSmsPacks } = await import("@/lib/server/billing-service");
    const result = await reconcileSmsPacks();
    expect(result).toMatchObject({ ok: true, checked: 0, healed: 0 });
    expect(called("rpc_billing_apply_pack_payment")).toBeUndefined();
  });

  it("records a failed run when Stripe does not answer, rather than going quiet", async () => {
    listingFails = true;
    rpcResults.set("rpc_billing_pack_reconciliation_findings", { data: [], error: null });

    const { reconcileSmsPacks } = await import("@/lib/server/billing-service");
    const result = await reconcileSmsPacks();
    expect(result).toMatchObject({ ok: false, errors: 1 });
    expect(called("rpc_billing_record_reconciliation_run")?.args).toMatchObject({ p_kind: "sms_packs", p_ok: false });
  });

  it("applies a pack refund weeks later that the webhook never delivered", async () => {
    const weeksAgo = Math.floor(Date.now() / 1000) - 20 * 24 * 60 * 60;
    listedEvents = [
      {
        id: "evt_missed_refund",
        type: "charge.refunded",
        created: weeksAgo,
        data: { object: { id: "ch_old", payment_intent: "pi_pack1", amount: 400, amount_refunded: 400 } },
      },
    ];
    rpcResults.set("rpc_billing_pack_reconciliation_findings", { data: [], error: null });

    const { reconcileSmsPacks } = await import("@/lib/server/billing-service");
    const result = await reconcileSmsPacks();

    const [params] = stripeCalls.find(({ method }) => method === "events.list")!.args as [Record<string, unknown>];
    expect(params["types"]).toEqual(expect.arrayContaining(["charge.refunded", "charge.dispute.created"]));
    // Stripe keeps events for 30 days, so that is how far back this looks.
    expect((params["created"] as { gte: number }).gte).toBeLessThanOrEqual(weeksAgo);
    expect(called("rpc_billing_apply_pack_refund")?.args).toMatchObject({ p_amount_refunded_cents: 400 });
    expect(result).toMatchObject({ ok: false, healed: 1 });
  });

  it("does not count an event the webhook already delivered", async () => {
    listedEvents = [
      {
        id: "evt_delivered",
        type: "charge.refunded",
        created: Math.floor(Date.now() / 1000) - 5 * 24 * 60 * 60,
        data: { object: { id: "ch_1", payment_intent: "pi_pack1", amount: 400, amount_refunded: 400 } },
      },
    ];
    rpcResults.set("rpc_stripe_event_record", { data: "duplicate", error: null });
    rpcResults.set("rpc_billing_pack_reconciliation_findings", { data: [], error: null });

    const { reconcileSmsPacks } = await import("@/lib/server/billing-service");
    const result = await reconcileSmsPacks();
    expect(result).toMatchObject({ ok: true, healed: 0 });
    expect(called("rpc_billing_apply_pack_refund")).toBeUndefined();
  });

  it("keeps going past one session that fails, and says so", async () => {
    listedSessions = [paidPackSession(), paidPackSession({ id: "cs_test_pack2", payment_intent: "pi_pack2" })];
    rpcResults.set("rpc_billing_pack_reconciliation_findings", { data: [], error: null });
    // The first session's apply fails; the second is healed regardless.
    rpcResults.set("rpc_billing_apply_pack_payment", (args) =>
      args["p_checkout_session_id"] === "cs_test_pack1"
        ? { data: null, error: { message: "boom" } }
        : { data: "granted", error: null },
    );

    const { reconcileSmsPacks } = await import("@/lib/server/billing-service");
    const result = await reconcileSmsPacks();
    expect(result).toMatchObject({ ok: false, checked: 2, errors: 1, healed: 1 });
    expect(called("rpc_billing_record_reconciliation_run")?.args).toMatchObject({ p_ok: false });
  });
});
