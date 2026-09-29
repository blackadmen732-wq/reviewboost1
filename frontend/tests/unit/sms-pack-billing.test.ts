import { readFileSync } from "node:fs";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * SMS packs, from the Stripe side.
 *
 * `supabase/tests/sms_pack_money_test.sql` proves the ledger: that a refund
 * takes back only unspent credit, never makes a balance negative, and turns
 * spent-and-refunded credit into a review. What is proved here is that every
 * Stripe event that can move money on a pack reaches that ledger with the
 * right numbers — and that events which are not about a pack do not.
 */

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
  return builder;
}

function fakeClient() {
  return {
    from: (table: string) => ({ select: () => queryBuilder(table) }),
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(rpcResults.get(name) ?? { data: null, error: null });
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({ createClient: () => fakeClient() }));

const ORG = "11111111-1111-1111-1111-111111111111";

const stripeCalls: Array<{ method: string; args: unknown[] }> = [];
let paymentIntentMetadata: Record<string, string> = {};
let listedSessions: unknown[] = [];

const fakeStripe = {
  paymentIntents: {
    retrieve: (...args: unknown[]) => {
      stripeCalls.push({ method: "paymentIntents.retrieve", args });
      return Promise.resolve({ id: args[0], customer: "cus_pack", metadata: paymentIntentMetadata });
    },
  },
  customers: {
    create: () => Promise.resolve({ id: "cus_new" }),
  },
  checkout: {
    sessions: {
      create: (...args: unknown[]) => {
        stripeCalls.push({ method: "checkout.sessions.create", args });
        return Promise.resolve({ url: "https://checkout.stripe.test/pack" });
      },
      list: (...args: unknown[]) => {
        stripeCalls.push({ method: "checkout.sessions.list", args });
        return {
          async *[Symbol.asyncIterator]() {
            for (const session of listedSessions) yield session;
          },
        };
      },
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

beforeEach(() => {
  rpcCalls.length = 0;
  stripeCalls.length = 0;
  rpcResults.clear();
  tableRows = new Map();
  paymentIntentMetadata = {};
  listedSessions = [];
  rpcResults.set("rpc_stripe_event_record", { data: "stored", error: null });
  rpcResults.set("rpc_billing_org_for_customer", { data: ORG, error: null });
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
});

function called(name: string): RpcCall | undefined {
  return rpcCalls.find((call) => call.name === name);
}

describe("the pack card", () => {
  it("is the same card in TypeScript and in the database that enforces it", async () => {
    const { SMS_PACKS } = await import("@/lib/server/sms-packs");
    const sql = readFileSync("../supabase/migrations/20260929000100_sms_pack_money.sql", "utf8");

    for (const [packId, pack] of Object.entries(SMS_PACKS)) {
      expect(sql).toMatch(
        new RegExp(
          `\\('${packId}',\\s+${pack.segments}::bigint,\\s+${pack.priceUsdCents}::bigint,\\s+'usd'\\)`,
        ),
      );
    }
  });

  it("is the same card on the owner's billing screen", async () => {
    const { SMS_PACKS } = await import("@/lib/server/sms-packs");
    const panel = readFileSync("features/dashboard/billing-panel.tsx", "utf8");

    for (const [packId, pack] of Object.entries(SMS_PACKS)) {
      expect(panel).toContain(
        `{ id: "${packId}", segments: ${pack.segments}, priceUsd: ${pack.priceUsdCents / 100} }`,
      );
    }
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
    return { db: createClient("", "") as never, userId: "user-1" };
  };

  it("is refused during a trial, which includes no SMS at all", async () => {
    tableRows.set("entitlement_snapshots", [
      { status: "trialing", trial_ends_at: new Date(Date.now() + 86_400_000).toISOString() },
    ]);
    const { createPackCheckoutSession } = await import("@/lib/server/billing-service");

    await expect(createPackCheckoutSession(await context(), ORG, "pack_50", "req-1")).rejects.toMatchObject({
      status: 403,
    });
    expect(stripeCalls.some(({ method }) => method === "checkout.sessions.create")).toBe(false);
  });

  it("is refused to a business whose plan has lapsed", async () => {
    tableRows.set("entitlement_snapshots", [{ status: "cancelled", trial_ends_at: null }]);
    const { createPackCheckoutSession } = await import("@/lib/server/billing-service");

    await expect(createPackCheckoutSession(await context(), ORG, "pack_50", "req-2")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("is a one-off payment, labelled as a pack on the session and the PaymentIntent", async () => {
    tableRows.set("entitlement_snapshots", [{ status: "active", trial_ends_at: null }]);
    tableRows.set("billing_customers", [{ stripe_customer_id: "cus_pack" }]);
    const { createPackCheckoutSession } = await import("@/lib/server/billing-service");

    const session = await createPackCheckoutSession(await context(), ORG, "pack_200", "req-3");
    expect(session.url).toContain("checkout.stripe.test");

    const [params] = stripeCalls.find(({ method }) => method === "checkout.sessions.create")!.args as [
      Record<string, unknown>,
    ];
    expect(params["mode"]).toBe("payment");
    expect(params["line_items"]).toEqual([{ price: "price_pack200_test", quantity: 1 }]);
    const metadata = { org_id: ORG, kind: "sms_pack", pack_id: "pack_200" };
    expect(params["metadata"]).toEqual(metadata);
    expect(params["payment_intent_data"]).toEqual({ metadata });
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
    const result = await reconcileSmsPacks({ now: new Date("2026-09-29T08:00:00Z") });

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
});

describe("a failed first payment after the seven-day Starter trial", () => {
  /**
   * The Stripe sequence, in order, as it arrives: the subscription starts
   * trialing, the trial's own $0 invoice is paid, the trial ends, the first
   * real invoice fails, the subscription goes past_due. Monthly SMS is minted
   * by exactly one thing — a paid invoice with money in it — and nothing in
   * this sequence is that. The database side of the same sequence is in
   * sms_pack_money_test.sql §10.
   */
  it("mints zero monthly SMS credits", async () => {
    rpcResults.set("rpc_billing_apply_subscription", { data: "applied", error: null });
    rpcResults.set("rpc_billing_apply_invoice_paid", { data: "not_paid", error: null });
    const { applyStripeEvent } = await import("@/lib/server/billing-service");

    const subscription = (status: string) => ({
      id: "sub_trial",
      customer: "cus_trial",
      status,
      cancel_at_period_end: false,
      trial_end: 1_790_604_800,
      metadata: { plan_id: "starter" },
      items: {
        data: [
          {
            price: { id: "price_starter_test" },
            current_period_start: 1_790_000_000,
            current_period_end: 1_790_604_800,
          },
        ],
      },
    });
    const invoice = (id: string, amountPaid: number, billingReason: string) => ({
      id,
      customer: "cus_trial",
      amount_paid: amountPaid,
      amount_due: 4900,
      billing_reason: billingReason,
      lines: {
        data: [
          {
            pricing: { price_details: { price: "price_starter_test" } },
            period: { start: 1_790_000_000, end: 1_790_604_800 },
          },
        ],
      },
    });

    await applyStripeEvent(event("customer.subscription.created", subscription("trialing"), "evt_1") as never);
    await applyStripeEvent(event("invoice.paid", invoice("in_trial", 0, "subscription_create"), "evt_2") as never);
    await applyStripeEvent(
      event("invoice.payment_failed", invoice("in_first", 0, "subscription_cycle"), "evt_3") as never,
    );
    await applyStripeEvent(event("customer.subscription.updated", subscription("past_due"), "evt_4") as never);

    const mints = rpcCalls.filter(({ name }) => name === "rpc_billing_apply_invoice_paid");
    // The only mint attempt is the trial's own invoice, for $0, which the
    // database answers `not_paid`. The failed invoice never reaches it.
    expect(mints).toHaveLength(1);
    expect(mints[0]?.args).toMatchObject({ p_invoice_id: "in_trial", p_amount_paid: 0 });
    expect(rpcCalls.some(({ name }) => name.includes("grant") || name.includes("credit"))).toBe(false);
  });

  it("does not mint on a proration invoice from a plan change either", async () => {
    const { applyStripeEvent } = await import("@/lib/server/billing-service");
    const outcome = await applyStripeEvent(
      event("invoice.paid", {
        id: "in_proration",
        customer: "cus_trial",
        amount_paid: 3000,
        billing_reason: "subscription_update",
        lines: { data: [{ price: { id: "price_growth_test" }, period: { start: 1, end: 2 } }] },
      }) as never,
    );

    expect(outcome).toBe("ignored");
    expect(called("rpc_billing_apply_invoice_paid")).toBeUndefined();
  });
});

describe("operational health", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPS_ALERT_WEBHOOK_URL;
    delete process.env.OPS_DISPATCH_STALL_SECONDS;
  });

  const quiet = {
    dispatch: { duePending: 0, oldestDueAgeSeconds: 0, expiredLeases: 0, stuckSending: 0 },
    deadLetters: { total: 3, last24h: 0, unreleased: 0 },
    providerUnknown: { count: 0, oldestAgeSeconds: 0 },
    smsWebhooks: { failed: 0, stuck: 0, unverifiedLastHour: 0 },
    stripeWebhooks: { unprocessed: 0, oldestUnprocessedAgeSeconds: 0 },
    packs: { paidWithoutCredit: 0, needsReview: 0, needsReviewSegments: 0, refundWithoutPayment: 0 },
    reconciliation: {
      lastRunAt: "2026-09-29T08:00:00Z",
      lastOkAt: "2026-09-29T08:00:00Z",
      lastFindings: 0,
      lastHealed: 0,
    },
  };
  const now = new Date("2026-09-29T09:00:00Z");

  it("is healthy when nothing is growing — old, released dead letters included", async () => {
    const { evaluateHealth } = await import("@/lib/server/ops-health");
    expect(evaluateHealth(quiet, { now })).toMatchObject({ ok: true, problems: [] });
  });

  it("names each failure that grows silently", async () => {
    const { evaluateHealth } = await import("@/lib/server/ops-health");
    const cases: Array<[string, unknown]> = [
      ["dispatch_stalled", { dispatch: { ...quiet.dispatch, oldestDueAgeSeconds: 601 } }],
      ["dispatch_leases_expired", { dispatch: { ...quiet.dispatch, expiredLeases: 1 } }],
      ["dispatch_stuck_sending", { dispatch: { ...quiet.dispatch, stuckSending: 1 } }],
      ["dead_letters", { deadLetters: { ...quiet.deadLetters, last24h: 1 } }],
      ["dead_letters_unreleased", { deadLetters: { ...quiet.deadLetters, unreleased: 1 } }],
      ["provider_unknown_backlog", { providerUnknown: { count: 2, oldestAgeSeconds: 3601 } }],
      ["sms_webhooks_failed", { smsWebhooks: { ...quiet.smsWebhooks, failed: 1 } }],
      ["sms_webhooks_failed", { smsWebhooks: { ...quiet.smsWebhooks, stuck: 1 } }],
      ["sms_webhooks_unverified", { smsWebhooks: { ...quiet.smsWebhooks, unverifiedLastHour: 11 } }],
      [
        "stripe_webhooks_unprocessed",
        { stripeWebhooks: { unprocessed: 1, oldestUnprocessedAgeSeconds: 901 } },
      ],
      ["pack_paid_without_credit", { packs: { ...quiet.packs, paidWithoutCredit: 1 } }],
      ["pack_refund_needs_review", { packs: { ...quiet.packs, needsReview: 1, needsReviewSegments: 3 } }],
      ["pack_refund_without_payment", { packs: { ...quiet.packs, refundWithoutPayment: 1 } }],
      [
        "pack_reconciliation_stale",
        { reconciliation: { ...quiet.reconciliation, lastRunAt: "2026-09-27T08:00:00Z" } },
      ],
      [
        "pack_reconciliation_findings",
        { reconciliation: { ...quiet.reconciliation, lastFindings: 2 } },
      ],
    ];

    for (const [problem, patch] of cases) {
      const report = evaluateHealth({ ...quiet, ...(patch as object) } as never, { now });
      expect(report.ok, problem).toBe(false);
      expect(report.problems, problem).toContain(problem);
    }
  });

  it("lets the stall threshold follow the scheduler's cadence", async () => {
    process.env.OPS_DISPATCH_STALL_SECONDS = String(26 * 60 * 60);
    const { evaluateHealth } = await import("@/lib/server/ops-health");
    const report = evaluateHealth(
      { ...quiet, dispatch: { ...quiet.dispatch, oldestDueAgeSeconds: 20 * 60 * 60 } },
      { now },
    );
    expect(report.problems).not.toContain("dispatch_stalled");
  });

  it("does not expect a reconciliation run where Stripe is not configured", async () => {
    const { evaluateHealth } = await import("@/lib/server/ops-health");
    const report = evaluateHealth(
      { ...quiet, reconciliation: { lastRunAt: null, lastOkAt: null, lastFindings: 0, lastHealed: 0 } },
      { now, reconciliationExpected: false },
    );
    expect(report.ok).toBe(true);
  });

  it("posts counts, never identities, to the configured alert webhook", async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = "https://hooks.example.test/alert";
    const fetchMock = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    const { evaluateHealth, raiseAlerts } = await import("@/lib/server/ops-health");
    const report = evaluateHealth({ ...quiet, packs: { ...quiet.packs, paidWithoutCredit: 2 } }, { now });

    expect(await raiseAlerts(report, "maintenance")).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://hooks.example.test/alert");
    const body = JSON.parse(String(init.body)) as { text: string };
    expect(body.text).toContain("pack_paid_without_credit");
    expect(body.text).toContain("packs paid without credit 2");
    expect(body.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("never throws when the alert cannot be delivered", async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = "https://hooks.example.test/alert";
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));

    const { evaluateHealth, raiseAlerts } = await import("@/lib/server/ops-health");
    const report = evaluateHealth({ ...quiet, packs: { ...quiet.packs, needsReview: 1 } }, { now });
    expect(await raiseAlerts(report, "maintenance")).toBe(false);
  });

  it("serves an unhealthy report as a 503, so an uptime monitor alerts on it", async () => {
    process.env.SMS_WORKER_SECRET = "worker-secret-value";
    rpcResults.set("rpc_ops_health", {
      data: { ...quiet, deadLetters: { total: 1, last24h: 1, unreleased: 1 } },
      error: null,
    });

    const { GET } = await import("@/app/api/v1/internal/health/route");
    const response = await GET(
      new Request("http://localhost:3000/api/v1/internal/health", {
        headers: { authorization: "Bearer worker-secret-value" },
      }) as never,
    );

    expect(response.status).toBe(503);
    const payload = (await response.json()) as { data: { ok: boolean; problems: string[] } };
    expect(payload.data.ok).toBe(false);
    expect(payload.data.problems).toEqual(
      expect.arrayContaining(["dead_letters", "dead_letters_unreleased"]),
    );
    delete process.env.SMS_WORKER_SECRET;
  });
});
