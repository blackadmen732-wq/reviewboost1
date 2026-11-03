import "server-only";

import type Stripe from "stripe";

import type { AuthenticatedContext } from "@/lib/server/auth";
import {
  effectiveStatus,
  type EntitlementStatus,
  PLANS,
  type PlanId,
  trialDaysFor,
} from "@/lib/server/entitlements";
import {
  planIdForPrice,
  publicFrontendUrl,
  stripePackPriceId,
  stripePackPricesConfigured,
  stripePriceId,
} from "@/lib/server/env";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { logger } from "@/lib/server/logger";
import {
  PACK_METADATA_KIND,
  type PackId,
  SMS_PACK_LIST,
  SMS_PACKS,
  type SmsPack,
} from "@/lib/server/sms-packs";
import { stripeClient } from "@/lib/server/stripe";
import { serviceRoleClient } from "@/lib/server/supabase";

/**
 * Billing.
 *
 * WHAT IS AUTHORITATIVE
 * ---------------------
 * Stripe's webhooks and this database. Not the browser: the success page
 * proves a redirect happened, not that money moved, and anyone who knows the
 * URL can open it. Nothing here reads a query parameter and grants a plan.
 *
 * WHAT A TRIAL IS
 * ---------------
 * Starter only. Seven days, no charge, a card required up front. One
 * location, one Tag, and no SMS at all. Growth and Pro have no trial: checkout
 * charges the first month immediately, and the paid invoice is what makes the
 * plan active and mints its texts. There is no
 * permanent free plan and no "we'll figure out the plan later" state — a trial
 * without a chosen plan is a subscription nobody knows how to renew.
 *
 * WHAT A TEXT PACK IS
 * -------------------
 * Extra texts, paid once, on a price of their own: 50, 200 or 500 at 8¢ each.
 * Monthly texts are spent first; bought texts never expire. Only an active
 * plan can buy one. A refund or a chargeback takes back what is unspent, and
 * what was already spent becomes a number an operator accounts for — never a
 * negative balance (docs/MONEY.md §4–§5).
 */

function unixToIso(value: number | null | undefined): string | null {
  return typeof value === "number" ? new Date(value * 1000).toISOString() : null;
}

/**
 * Stripe's subscription shape moves between API versions; this reads the
 * fields defensively rather than asserting a shape a future version may
 * rename, because the alternative is a webhook that throws and a business
 * whose plan silently stops updating.
 */
function subscriptionFields(subscription: Stripe.Subscription): {
  priceId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
} {
  const item = subscription.items?.data?.[0] as
    | { price?: { id?: string }; current_period_start?: number; current_period_end?: number }
    | undefined;
  const legacy = subscription as unknown as {
    current_period_start?: number;
    current_period_end?: number;
  };

  return {
    priceId: item?.price?.id ?? null,
    currentPeriodStart: unixToIso(item?.current_period_start ?? legacy.current_period_start),
    currentPeriodEnd: unixToIso(item?.current_period_end ?? legacy.current_period_end),
  };
}

/** The parts of an invoice line this file reads, across API versions. */
interface InvoiceLineShape {
  parent?: {
    type?: string;
    subscription_item_details?: { proration?: boolean } | null;
    invoice_item_details?: { proration?: boolean } | null;
  } | null;
  /** Before `parent`: "subscription" or "invoiceitem". */
  type?: string;
  /** Before `parent`. */
  proration?: boolean;
  pricing?: { price_details?: { price?: string | { id?: string } } };
  price?: { id?: string } | string;
  plan?: { id?: string };
  period?: { start?: number; end?: number };
}

function isProration(line: InvoiceLineShape): boolean {
  return Boolean(
    line.parent?.subscription_item_details?.proration ??
      line.parent?.invoice_item_details?.proration ??
      line.proration,
  );
}

function isSubscriptionLine(line: InvoiceLineShape): boolean {
  if (line.parent?.type) return line.parent.type === "subscription_item_details";
  if (line.type) return line.type === "subscription";
  return true;
}

/**
 * The line that pays for the coming period.
 *
 * Not simply the first line. After a plan change, the renewal invoice opens
 * with the proration lines — "unused time on Starter" first — and only then
 * the new plan's period. Reading line 0 there mints the old plan's allowance,
 * dated to a period that has already ended, so a business that upgraded pays
 * for Growth and receives texts that expire on arrival.
 *
 * An invoice made only of prorations (an upgrade invoiced immediately) has no
 * such line. It mints nothing; the new plan's allowance arrives with the next
 * period's invoice, as every other allowance does.
 */
function periodLine(invoice: Stripe.Invoice): InvoiceLineShape | undefined {
  const lines = (invoice.lines?.data ?? []) as unknown as InvoiceLineShape[];
  return lines.find((line) => isSubscriptionLine(line) && !isProration(line));
}

/**
 * The price a period line was for.
 *
 * Stripe moved this. Through the 2025 API versions a line item carried
 * `price`; from `2026-08-26.dahlia` it carries `pricing.price_details.price`,
 * which is a price id or an expanded Price. Reading only the old shape does
 * not fail loudly — `planIdForPrice` is handed null, the invoice mints no
 * monthly allowance, and a business that paid gets no SMS with no error
 * anywhere. Both shapes are read, newest first, and a subscription line's own
 * price is the last resort.
 */
function linePriceId(line: InvoiceLineShape | undefined): string | null {
  if (!line) return null;

  const fromPricing = line.pricing?.price_details?.price;
  if (typeof fromPricing === "string") return fromPricing;
  if (fromPricing?.id) return fromPricing.id;

  if (typeof line.price === "string") return line.price;
  if (line.price?.id) return line.price.id;

  // Older still: a subscription line reported its plan rather than its price.
  return line.plan?.id ?? null;
}

/** A Stripe reference that may arrive as an id or as the expanded object. */
function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

async function orgForCustomer(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;

  const { data, error } = await serviceRoleClient().rpc("rpc_billing_org_for_customer", {
    p_stripe_customer_id: customerId,
  });

  if (error) throw error;
  return typeof data === "string" ? data : null;
}

/**
 * What went wrong, in words an operator reading the inbox can act on. A
 * Supabase RPC error is a plain object, not an `Error`, so `String(error)`
 * records "[object Object]" for every database failure — including the
 * `unknown_price` that tells someone exactly which row to add.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const { message, code, details } = error as { message?: unknown; code?: unknown; details?: unknown };
    const parts = [message, code ? `(${String(code)})` : null, details]
      .filter((part) => typeof part === "string" && part.length > 0);
    if (parts.length > 0) return parts.join(" ");
  }
  return String(error);
}

/**
 * What went wrong, safe for an error log: the message and code only. Never
 * PostgREST's `details`, which for a constraint failure quotes the failing
 * ledger row — payment ids and amounts the logger's key redaction cannot see
 * once they are inside one string.
 */
function errorSummary(error: unknown): { message: string; code: string | null } {
  if (error instanceof Error) return { message: error.message, code: null };
  if (error && typeof error === "object") {
    const { message, code } = error as { message?: unknown; code?: unknown };
    return {
      message: typeof message === "string" ? message : "unknown",
      code: typeof code === "string" ? code : null,
    };
  }
  return { message: String(error), code: null };
}

/**
 * An event for a price the database does not map, or whose plan the two
 * sides disagree on, is an operator problem, not a transient one: it will
 * fail on every retry until someone edits `billing_plan_prices` or the
 * deployment's STRIPE_PRICE_* variables. Logged at error level with a stable
 * event name so an alert can key on it.
 */
function reportUnknownPrice(
  error: { message?: string },
  event: Stripe.Event,
  priceId: string | null,
): void {
  const message = error.message ?? "";
  if (message.includes("unknown_price") || message.includes("plan_price_mismatch")) {
    logger.error("billing.price_unmapped", {
      eventId: event.id,
      type: event.type,
      priceId,
      reason: message.includes("unknown_price") ? "unknown_price" : "plan_price_mismatch",
    });
  }
}

// ------------------------------------------------------------- checkout ----

/**
 * Start a subscription.
 *
 * The Stripe customer is created once per organization and recorded before
 * the session exists, so a customer that Stripe created can always be found
 * again — a second checkout must not produce a second customer and a second
 * subscription for the same business.
 */
export async function createCheckoutSession(
  context: AuthenticatedContext,
  orgId: string,
  planId: PlanId,
  requestId: string,
): Promise<{ url: string }> {
  const stripe = stripeClient();
  const price = stripePriceId(planId);

  const { data: existing, error: lookupError } = await context.db
    .from("billing_subscriptions")
    .select("stripe_status")
    .eq("org_id", orgId)
    .maybeSingle();

  if (lookupError) {
    logger.error("billing.lookup_failed", { requestId, orgId, error: lookupError });
    throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
  }

  const status = (existing as { stripe_status?: string } | null)?.stripe_status;
  if (status === "active" || status === "trialing" || status === "past_due") {
    throw new ApiError(
      409,
      ERROR_CODE.validationFailed,
      "This business already has a subscription. Change the plan from billing settings.",
    );
  }

  const customerId = await ensureStripeCustomer(orgId, requestId);
  const origin = publicFrontendUrl();

  // A business that has subscribed before does not get a second trial by
  // cancelling and checking out again.
  const trialDays = existing ? 0 : trialDaysFor(planId);

  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      // A card is always required: before Starter's trial starts, and to pay
      // Growth and Pro today. A trial without one is a free plan with a timer.
      payment_method_collection: "always",
      subscription_data: {
        // Only Starter has a trial. Omitting the field charges immediately.
        ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
        metadata: { org_id: orgId, plan_id: planId },
      },
      client_reference_id: orgId,
      metadata: { org_id: orgId, plan_id: planId },
      success_url: `${origin}/settings/billing?checkout=complete`,
      cancel_url: `${origin}/settings/billing?checkout=cancelled`,
    },
    // Retrying this request must not create a second subscription.
    { idempotencyKey: `checkout:${orgId}:${planId}:${requestId}` },
  );

  if (!session.url) {
    logger.error("billing.checkout_no_url", { requestId, orgId });
    throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
  }

  return { url: session.url };
}

export async function ensureStripeCustomer(orgId: string, requestId: string): Promise<string> {
  const service = serviceRoleClient();

  const { data: existing, error } = await service.rpc("rpc_billing_customer_for_org", {
    p_org_id: orgId,
  });

  if (error) throw error;

  const found = typeof existing === "string" && existing.length > 0 ? existing : null;
  if (found) return found;

  const customer = await stripeClient().customers.create(
    { metadata: { org_id: orgId } },
    { idempotencyKey: `customer:${orgId}` },
  );

  const { error: linkError } = await service.rpc("rpc_billing_link_customer", {
    p_org_id: orgId,
    p_stripe_customer_id: customer.id,
  });

  if (linkError) {
    logger.error("billing.link_failed", { requestId, orgId, error: linkError });
    throw linkError;
  }

  return customer.id;
}

export async function createPortalSession(
  orgId: string,
  requestId: string,
): Promise<{ url: string }> {
  const customerId = await ensureStripeCustomer(orgId, requestId);
  const session = await stripeClient().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${publicFrontendUrl()}/settings/billing`,
  });

  return { url: session.url };
}

// ------------------------------------------------------------ text packs ---

/**
 * When Stripe last agreed that a pack's configured price is the card's price.
 *
 * Checked before an owner is sent to pay, so a mistyped price in the Stripe
 * dashboard turns into a refused checkout — not a charge the database will
 * then refuse to credit. Remembered briefly so a busy minute is one lookup.
 */
const verifiedPackPrices = new Map<string, number>();
const PACK_PRICE_CHECK_TTL_MS = 10 * 60 * 1000;

export function __resetPackPriceChecksForTests(): void {
  verifiedPackPrices.clear();
}

async function assertPackPrice(pack: SmsPack, priceId: string, requestId: string): Promise<void> {
  const checkedAt = verifiedPackPrices.get(priceId);
  if (checkedAt !== undefined && Date.now() - checkedAt < PACK_PRICE_CHECK_TTL_MS) return;

  const price = await stripeClient().prices.retrieve(priceId);
  const matches =
    price.active &&
    price.type === "one_time" &&
    price.currency === "usd" &&
    price.unit_amount === pack.priceUsdCents;

  if (!matches) {
    // An operator problem with a stable name, so an alert can key on it.
    logger.error("billing.pack_price_mismatch", {
      requestId,
      packId: pack.id,
      priceId,
      active: price.active,
      type: price.type,
      currency: price.currency,
      unitAmount: price.unit_amount,
    });
    throw new ApiError(
      503,
      ERROR_CODE.serviceUnavailable,
      "Extra texts can't be bought right now. Please try again later.",
    );
  }

  verifiedPackPrices.set(priceId, Date.now());
}

/**
 * Buy a text pack.
 *
 * A one-off payment, never a subscription line: software and texts do not
 * share a Stripe price. Only a business whose plan is active may buy one — a
 * trial includes no texts at all, and a past-due, suspended or cancelled
 * business is not sold more of something it cannot pay for. The pack is
 * granted by the webhook, from the database's own catalog, and only if Stripe
 * collected the catalog price (docs/MONEY.md §4.2).
 */
export async function createPackCheckoutSession(
  context: AuthenticatedContext,
  orgId: string,
  packId: PackId,
  requestId: string,
): Promise<{ url: string }> {
  const { data: entitlement, error } = await context.db
    .from("entitlement_snapshots")
    .select("status, trial_ends_at, cancel_at_period_end")
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) {
    logger.error("billing.pack_entitlement_failed", { requestId, orgId, error: errorSummary(error) });
    throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
  }

  const row = entitlement as {
    status: EntitlementStatus;
    trial_ends_at: string | null;
    cancel_at_period_end: boolean | null;
  } | null;
  const status = row ? effectiveStatus(row.status, row.trial_ends_at) : "suspended";
  if (status !== "active") {
    throw new ApiError(
      403,
      ERROR_CODE.forbidden,
      "Extra texts can be bought once your plan is active.",
    );
  }
  // A plan that is set to end is not sold texts it will not be there to send.
  if (row?.cancel_at_period_end) {
    throw new ApiError(
      403,
      ERROR_CODE.forbidden,
      "Your plan is set to end, so extra texts can't be bought. Turn renewal back on under Manage plan and payment first.",
    );
  }

  const pack = SMS_PACKS[packId];

  let session: Stripe.Checkout.Session;
  try {
    const price = stripePackPriceId(packId);
    await assertPackPrice(pack, price, requestId);

    const customerId = await ensureStripeCustomer(orgId, requestId);
    const origin = publicFrontendUrl();
    const metadata = { org_id: orgId, kind: PACK_METADATA_KIND, pack_id: packId };

    session = await stripeClient().checkout.sessions.create(
      {
        mode: "payment",
        customer: customerId,
        line_items: [{ price, quantity: 1 }],
        client_reference_id: orgId,
        metadata,
        // Copied onto the PaymentIntent so a refund or dispute, which Stripe
        // reports against the charge, can be recognised as a pack.
        payment_intent_data: { metadata },
        success_url: `${origin}/settings/billing?pack=complete`,
        cancel_url: `${origin}/settings/billing?pack=cancelled`,
        // Stripe's shortest life for a session (30 minutes, plus a minute for
        // clock drift). The plan was checked as active just now; a payment
        // page left open for a day could be paid after it no longer is.
        expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      },
      // Retrying this request must not open a second payment.
      { idempotencyKey: `pack:${orgId}:${packId}:${requestId}` },
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Stripe unreachable, a key missing, a customer that could not be made:
    // nothing was charged, and the owner is told that and what to do. The
    // cause goes to the log, never to the page.
    logger.error("billing.pack_checkout_failed", { requestId, orgId, error: errorSummary(error) });
    throw new ApiError(
      503,
      ERROR_CODE.serviceUnavailable,
      "We couldn't open the payment page, so nothing was charged. Please try again in a minute.",
    );
  }

  if (!session.url) {
    logger.error("billing.pack_checkout_no_url", { requestId, orgId });
    throw new ApiError(
      503,
      ERROR_CODE.serviceUnavailable,
      "We couldn't open the payment page, so nothing was charged. Please try again in a minute.",
    );
  }

  return { url: session.url };
}

// ------------------------------------------------------------- webhooks ----

export type EventOutcome =
  | "applied"
  | "stale"
  | "duplicate"
  | "ignored"
  | "unknown_customer"
  // A pack was paid for and deliberately not granted — the wrong amount, or a
  // pack the catalog does not know. Recorded in the ledger, surfaced by
  // health and reconciliation, and not retried: a retry cannot fix a price.
  | "paid_without_credit";

type PackOrg =
  | { kind: "pack"; orgId: string }
  | { kind: "not_pack" }
  | { kind: "unknown_customer" }
  // The business deleted its account; its customer and purchases went with it.
  | { kind: "deleted" };

/**
 * Whether the business a pack's metadata names deleted its account.
 *
 * A refund, a chargeback or a delayed payment can arrive after the business
 * is gone, and then neither its Stripe customer nor its purchase is here to
 * find. That is finished, not lost: answering "unknown customer" would make
 * Stripe retry it for days and keep health red for nothing.
 */
async function packOrgWasDeleted(labelledOrgId: string | null | undefined): Promise<boolean> {
  if (!labelledOrgId) return false;
  const { data, error } = await serviceRoleClient().rpc("rpc_billing_org_deleted", {
    p_org_id: labelledOrgId,
  });
  if (error) throw error;
  return data === true;
}

/**
 * Whether a PaymentIntent paid for a pack, and whose.
 *
 * A pack already recorded answers from the database. Otherwise Stripe is
 * asked, because a refund can arrive before the payment it refunds and a
 * dispute names no customer at all. A PaymentIntent that is not a pack — a
 * subscription invoice's — is not ours to claw back.
 */
async function resolvePackOrg(paymentIntentId: string): Promise<PackOrg> {
  const { data, error } = await serviceRoleClient().rpc("rpc_billing_pack_org", {
    p_payment_intent_id: paymentIntentId,
  });
  if (error) throw error;
  if (typeof data === "string") return { kind: "pack", orgId: data };

  const intent = await stripeClient().paymentIntents.retrieve(paymentIntentId);
  if (intent.metadata?.["kind"] !== PACK_METADATA_KIND) return { kind: "not_pack" };

  const orgId = await orgForCustomer(idOf(intent.customer as string | { id: string } | null));
  if (orgId) return { kind: "pack", orgId };
  return (await packOrgWasDeleted(intent.metadata?.["org_id"])) ? { kind: "deleted" } : { kind: "unknown_customer" };
}

/**
 * Grant one paid pack. Shared by the webhook and by reconciliation, so the
 * two cannot disagree about what a paid Checkout Session is worth.
 */
async function applyPackPayment(
  session: Stripe.Checkout.Session,
  eventId: string,
): Promise<"granted" | "duplicate" | "paid_without_credit" | "not_paid" | "unknown_customer" | "deleted"> {
  if (session.payment_status !== "paid") return "not_paid";

  const orgId = await orgForCustomer(idOf(session.customer as string | { id: string } | null));
  if (!orgId) {
    if (await packOrgWasDeleted(session.metadata?.["org_id"])) {
      logger.warn("billing.pack_event_after_deletion", { checkoutSession: session.id });
      return "deleted";
    }
    return "unknown_customer";
  }

  // The session's metadata was written by our own server, and the event is
  // signed. It still has to agree with the customer on record: a pack is
  // credited to the business that paid, not the one a label names.
  const labelled = session.metadata?.["org_id"];
  if (labelled && labelled !== orgId) {
    throw new Error("pack session org does not match its Stripe customer");
  }

  const paymentIntentId = idOf(session.payment_intent as string | { id: string } | null);
  if (!paymentIntentId) throw new Error("paid pack session has no payment intent");

  const { data, error } = await serviceRoleClient().rpc("rpc_billing_apply_pack_payment", {
    p_org_id: orgId,
    p_payment_intent_id: paymentIntentId,
    p_checkout_session_id: session.id,
    p_pack_id: session.metadata?.["pack_id"] ?? null,
    p_amount_cents: session.amount_total ?? null,
    p_currency: session.currency ?? null,
    p_event_id: eventId,
  });
  if (error) throw error;

  if (data === "granted" || data === "duplicate") return data;

  logger.error("billing.pack_paid_without_credit", {
    orgId,
    checkoutSession: session.id,
    reason: typeof data === "string" ? data : "unknown",
  });
  return "paid_without_credit";
}

async function applyPackRefund(charge: Stripe.Charge, eventId: string): Promise<EventOutcome> {
  const paymentIntentId = idOf(charge.payment_intent as string | { id: string } | null);
  if (!paymentIntentId) return "ignored";

  const pack = await resolvePackOrg(paymentIntentId);
  if (pack.kind === "not_pack") return "ignored";
  if (pack.kind === "deleted") {
    logger.warn("billing.pack_event_after_deletion", { paymentIntentId, kind: "refund" });
    return "ignored";
  }
  if (pack.kind === "unknown_customer") return "unknown_customer";

  const { data, error } = await serviceRoleClient().rpc("rpc_billing_apply_pack_refund", {
    p_org_id: pack.orgId,
    p_payment_intent_id: paymentIntentId,
    p_charge_amount_cents: charge.amount,
    p_amount_refunded_cents: charge.amount_refunded ?? 0,
    p_event_id: eventId,
  });
  if (error) throw error;

  logRefundShortfall(pack.orgId, paymentIntentId, data);
  return "applied";
}

async function applyPackDispute(
  dispute: Stripe.Dispute,
  eventId: string,
  eventCreated: string,
): Promise<EventOutcome> {
  const paymentIntentId = idOf(dispute.payment_intent as string | { id: string } | null);
  if (!paymentIntentId) return "ignored";

  const pack = await resolvePackOrg(paymentIntentId);
  if (pack.kind === "not_pack") return "ignored";
  if (pack.kind === "deleted") {
    logger.warn("billing.pack_event_after_deletion", { paymentIntentId, kind: "dispute" });
    return "ignored";
  }
  if (pack.kind === "unknown_customer") return "unknown_customer";

  const { data, error } = await serviceRoleClient().rpc("rpc_billing_apply_pack_dispute", {
    p_org_id: pack.orgId,
    p_payment_intent_id: paymentIntentId,
    p_dispute_id: dispute.id,
    p_dispute_status: dispute.status,
    p_event_created: eventCreated,
    p_event_id: eventId,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? (data[0] as { outcome?: string } | undefined) : undefined;
  logRefundShortfall(pack.orgId, paymentIntentId, data);
  return row?.outcome === "stale" ? "stale" : "applied";
}

/** Spent credit that a refund could not take back is an accounting event. */
function logRefundShortfall(orgId: string, paymentIntentId: string, data: unknown): void {
  const row = Array.isArray(data)
    ? (data[0] as { outstanding_segments?: number | string } | undefined)
    : undefined;
  const outstanding = Number(row?.outstanding_segments ?? 0);
  if (outstanding > 0) {
    logger.warn("billing.pack_clawback_outstanding", { orgId, paymentIntentId, outstanding });
  }
}

/** Stripe statuses after which a subscription can never bill again. */
const ENDED_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set(["canceled", "incomplete_expired"]);

/**
 * Apply one Stripe event.
 *
 * Every branch is idempotent at the database, so this may be called again for
 * the same event without consequence — which is what Stripe's at-least-once
 * delivery requires.
 */
export async function applyStripeEvent(event: Stripe.Event): Promise<EventOutcome> {
  const service = serviceRoleClient();
  const eventCreated = new Date(event.created * 1000).toISOString();

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const orgId = await orgForCustomer(idOf(subscription.customer));
      if (!orgId) {
        // A subscription that has ended, for a customer we no longer hold, is
        // what deleting an account produces: the route cancels in Stripe, the
        // cascade removes `billing_customers`, and Stripe's
        // `customer.subscription.deleted` arrives a moment later. There is
        // nothing left to apply. Leaving it unprocessed kept health at 503 for
        // good — Stripe is answered 200 and never retries it — and the release
        // gate with it. A live subscription we cannot place is still left
        // visible, because that one is money nobody is accounting for.
        return ENDED_SUBSCRIPTION_STATUSES.has(subscription.status) ? "ignored" : "unknown_customer";
      }

      const fields = subscriptionFields(subscription);
      // The price decides the plan, and the database owns that mapping
      // (`billing_plan_prices`). This deployment's own reading of the price
      // is sent only as a cross-check: if the two disagree the event fails
      // loudly instead of either one being believed. Subscription metadata is
      // never consulted — it is a free-text field nobody pays for.
      const planId = planIdForPrice(fields.priceId);

      const { data, error } = await service.rpc("rpc_billing_apply_subscription", {
        p_org_id: orgId,
        p_stripe_subscription_id: subscription.id,
        p_stripe_price_id: fields.priceId,
        p_plan_id: planId,
        p_stripe_status: subscription.status,
        p_cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
        p_current_period_start: fields.currentPeriodStart,
        p_current_period_end: fields.currentPeriodEnd,
        p_trial_ends_at: unixToIso(subscription.trial_end),
        p_event_id: event.id,
        p_event_created: eventCreated,
      });

      if (error) {
        reportUnknownPrice(error, event, fields.priceId);
        throw error;
      }
      return data === "stale" ? "stale" : "applied";
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const orgId = await orgForCustomer(idOf(invoice.customer));
      if (!orgId) return "unknown_customer";

      const line = periodLine(invoice);

      // THE ONLY THING THAT MINTS MONTHLY SMS. Not checkout, not subscription
      // creation: a paid invoice for a billing period, once, expiring at the
      // end of the period it paid for.
      // The price, not a plan name: the database maps it, and an unknown
      // price fails the event rather than minting anyone's allowance.
      const priceId = linePriceId(line);
      const { error } = await service.rpc("rpc_billing_apply_invoice_paid", {
        p_org_id: orgId,
        p_invoice_id: invoice.id,
        p_stripe_price_id: priceId,
        p_period_start: unixToIso(line?.period?.start),
        p_period_end: unixToIso(line?.period?.end),
        p_amount_paid: invoice.amount_paid ?? 0,
      });

      if (error) {
        reportUnknownPrice(error, event, priceId);
        throw error;
      }
      return "applied";
    }

    case "invoice.payment_failed": {
      // Deliberately nothing here. A failed invoice mints no allowance, and
      // the entitlement change that follows arrives as a subscription update
      // with Stripe's own status — inferring `past_due` from a failure would
      // race that event and could contradict it.
      return "ignored";
    }

    // ------------------------------------------------------ text packs ----

    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      // Subscription checkouts are applied through their subscription and
      // invoice events; only a pack's payment session mints anything here.
      if (session.mode !== "payment" || session.metadata?.["kind"] !== PACK_METADATA_KIND) {
        return "ignored";
      }
      const outcome = await applyPackPayment(session, event.id);
      if (outcome === "unknown_customer") return "unknown_customer";
      if (outcome === "paid_without_credit") return "paid_without_credit";
      // `not_paid` is a delayed payment method: its own success event follows.
      // `deleted`: the business is gone, and so is everything it could be given.
      if (outcome === "not_paid" || outcome === "deleted") return "ignored";
      // Already granted — by the other checkout event, or by reconciliation.
      // Nothing new happened, and reconciliation must not count it as a heal.
      return outcome === "duplicate" ? "duplicate" : "applied";
    }

    case "charge.refunded":
      return applyPackRefund(event.data.object as Stripe.Charge, event.id);

    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed":
    case "charge.dispute.funds_withdrawn":
    case "charge.dispute.funds_reinstated":
      return applyPackDispute(event.data.object as Stripe.Dispute, event.id, eventCreated);

    default:
      return "ignored";
  }
}

/**
 * Receive one webhook: verify, store, handle, mark.
 *
 * The signature is verified before anything is written, so the inbox cannot
 * be filled by anyone who can reach the URL. The event is stored keyed by
 * Stripe's own id, so a redelivery is a no-op. A handler failure leaves the
 * row unprocessed with its error recorded, which is both the retry signal and
 * the thing an operator can look at.
 */
export async function receiveStripeWebhook(
  event: Stripe.Event,
): Promise<{ outcome: EventOutcome }> {
  const service = serviceRoleClient();

  const { data: recorded, error: recordError } = await service.rpc("rpc_stripe_event_record", {
    p_event_id: event.id,
    p_type: event.type,
    p_payload: event as unknown as Record<string, unknown>,
    p_event_created: new Date(event.created * 1000).toISOString(),
  });

  if (recordError) throw recordError;
  if (recorded === "duplicate") return { outcome: "duplicate" };

  try {
    const outcome = await applyStripeEvent(event);
    if (outcome === "unknown_customer") {
      // A newly created Stripe customer may arrive before its organization
      // link is visible. Keep the inbox unprocessed AND return a retryable
      // HTTP 500: a successful 200 would stop Stripe from redelivering it.
      throw new Error("no organization for this Stripe customer");
    }

    const { error: completeError } = await service.rpc("rpc_stripe_event_complete", {
      p_event_id: event.id,
    });
    // Stripe may retry if we couldn't persist the completion marker. The
    // subscription and invoice handlers are idempotent, so this is safe.
    if (completeError) throw completeError;

    return { outcome };
  } catch (error) {
    const { error: failError } = await service.rpc("rpc_stripe_event_fail", {
      p_event_id: event.id,
      p_error: describeError(error),
    });
    if (failError) {
      logger.error("billing.webhook_failure_record_failed", {
        eventId: event.id,
        reason: describeError(failError),
      });
    }
    throw error;
  }
}

// -------------------------------------------------------- reconciliation ---

export interface PackReconciliation {
  ok: boolean;
  /** Paid pack Checkout Sessions Stripe reported in the window. */
  checked: number;
  /**
   * Money events this run applied that had not been applied before: a paid
   * pack with no grant, or a pack refund or dispute the webhook never
   * delivered. Each one is a webhook that failed, so a heal is worth an alert
   * even though it is fixed.
   */
  healed: number;
  /** Rows the database says a human should look at. */
  findings: number;
  errors: number;
  byKind: Record<string, number>;
}

/** Paid sessions are re-applied for a week; Stripe keeps events for 30 days. */
const RECONCILE_SESSION_LOOKBACK_DAYS = 7;
const RECONCILE_EVENT_LOOKBACK_DAYS = 30;
/** A session this young may simply have its webhook still in flight. */
const RECONCILE_MIN_SESSION_AGE_SECONDS = 60 * 60;
/** Each Stripe call, and the whole run, end well inside a function's life. */
const RECONCILE_STRIPE_TIMEOUT_MS = 15_000;
const RECONCILE_BUDGET_MS = 60_000;

/** The Stripe events that move money on a pack, replayed through the webhook path. */
const PACK_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
] as const;

/**
 * Stripe's record of pack money against the credit the ledger gave.
 *
 * Stripe is the record of what was paid; the grants are the record of what
 * was given. Two passes, both through the same idempotent paths the webhook
 * uses, so a missed webhook is healed rather than merely reported:
 *
 * 1. Every paid pack Checkout Session from the last week (older than an hour,
 *    so a webhook still in flight is not mistaken for a missing one) is
 *    applied again, and any refund or dispute on its charge carried across.
 * 2. Every pack money event from the last 30 days — Stripe's whole retention —
 *    is offered to the webhook handler. The inbox already has the ones that
 *    arrived, so they cost a lookup; a refund or chargeback that came weeks
 *    after the purchase and never reached us is applied here.
 *
 * Then the database lists anything that still does not add up, and the run is
 * always recorded — including one Stripe never answered — so health can say
 * reconciliation failed instead of going quiet. Idempotent end to end.
 */
export async function reconcileSmsPacks(
  options: { now?: Date } = {},
): Promise<PackReconciliation> {
  const service = serviceRoleClient();
  const stripe = stripeClient();
  const startedAt = options.now ?? new Date();
  const startedMs = Date.now();
  const nowSeconds = Math.floor(startedAt.getTime() / 1000);
  const eventId = `reconcile:${startedAt.toISOString()}`;
  const requestOptions = { timeout: RECONCILE_STRIPE_TIMEOUT_MS };
  const overBudget = () => Date.now() - startedMs > RECONCILE_BUDGET_MS;

  const result: PackReconciliation = {
    ok: true,
    checked: 0,
    healed: 0,
    findings: 0,
    errors: 0,
    byKind: {},
  };

  try {
    // ---- 1. paid sessions -------------------------------------------------
    const sessions = stripe.checkout.sessions.list(
      {
        created: { gte: nowSeconds - RECONCILE_SESSION_LOOKBACK_DAYS * 24 * 60 * 60 },
        limit: 100,
        expand: ["data.payment_intent.latest_charge"],
      },
      requestOptions,
    );

    for await (const session of sessions) {
      if (overBudget()) {
        result.errors += 1;
        logger.error("billing.pack_reconcile_over_budget", { pass: "sessions" });
        break;
      }
      if (session.mode !== "payment" || session.metadata?.["kind"] !== PACK_METADATA_KIND) continue;
      if (session.payment_status !== "paid") continue;
      if (session.created > nowSeconds - RECONCILE_MIN_SESSION_AGE_SECONDS) continue;
      result.checked += 1;

      try {
        const outcome = await applyPackPayment(session, eventId);
        if (outcome === "granted") {
          result.healed += 1;
          logger.error("billing.pack_reconcile_healed", { checkoutSession: session.id });
        }

        const intent = typeof session.payment_intent === "object" ? session.payment_intent : null;
        const charge =
          intent && typeof intent.latest_charge === "object" ? intent.latest_charge : null;

        if (charge && (charge.amount_refunded ?? 0) > 0) {
          await applyPackRefund(charge, eventId);
        }
        if (charge?.disputed && intent) {
          const disputes = await stripe.disputes.list(
            { payment_intent: intent.id, limit: 1 },
            requestOptions,
          );
          const dispute = disputes.data[0];
          if (dispute) await applyPackDispute(dispute, eventId, startedAt.toISOString());
        }
      } catch (error) {
        result.errors += 1;
        logger.error("billing.pack_reconcile_session_failed", {
          checkoutSession: session.id,
          error: errorSummary(error),
        });
      }
    }

    // ---- 2. money events the webhook may have missed ------------------------
    const events = stripe.events.list(
      {
        types: [...PACK_EVENT_TYPES],
        created: { gte: nowSeconds - RECONCILE_EVENT_LOOKBACK_DAYS * 24 * 60 * 60 },
        limit: 100,
      },
      requestOptions,
    );

    for await (const event of events) {
      if (overBudget()) {
        result.errors += 1;
        logger.error("billing.pack_reconcile_over_budget", { pass: "events" });
        break;
      }
      // Too young to call missing: its own delivery may still be on the way.
      if (event.created > nowSeconds - RECONCILE_MIN_SESSION_AGE_SECONDS) continue;

      try {
        const { outcome } = await receiveStripeWebhook(event);
        // `duplicate` is the normal case: the webhook delivered it. Anything
        // else that was about a pack is money this run had to apply itself.
        if (outcome === "applied" || outcome === "paid_without_credit") {
          result.healed += 1;
          logger.error("billing.pack_reconcile_event_replayed", { eventId: event.id, type: event.type });
        }
      } catch (error) {
        result.errors += 1;
        logger.error("billing.pack_reconcile_event_failed", {
          eventId: event.id,
          type: event.type,
          error: errorSummary(error),
        });
      }
    }
  } catch (error) {
    // Stripe did not answer the listing at all. Recorded below as a failed
    // run, so health reports the reconciliation — not the whole worker.
    result.errors += 1;
    logger.error("billing.pack_reconcile_stripe_failed", { error: errorSummary(error) });
  }

  const { data: findings, error: findingsError } = await service.rpc(
    "rpc_billing_pack_reconciliation_findings",
  );
  if (findingsError) {
    result.errors += 1;
    logger.error("billing.pack_reconcile_findings_failed", { error: errorSummary(findingsError) });
  } else {
    for (const row of (Array.isArray(findings) ? findings : []) as Array<{ kind: string }>) {
      result.byKind[row.kind] = (result.byKind[row.kind] ?? 0) + 1;
      result.findings += 1;
    }
  }

  result.ok = result.errors === 0 && result.findings === 0 && result.healed === 0;

  const { error: recordError } = await service.rpc("rpc_billing_record_reconciliation_run", {
    p_kind: "sms_packs",
    p_started_at: startedAt.toISOString(),
    p_ok: result.ok,
    p_checked: result.checked,
    p_healed: result.healed,
    p_findings: result.findings,
    p_detail: { byKind: result.byKind, errors: result.errors },
  });
  if (recordError) {
    logger.error("billing.pack_reconcile_record_failed", { error: errorSummary(recordError) });
  }

  return result;
}

// ------------------------------------------------------------- read side ---

export interface BillingState {
  planId: PlanId | null;
  status: string;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  smsBalance: { monthly: number; purchased: number; total: number };
  plans: typeof PLANS;
  /** The text pack card, smallest first. Shown whether or not it can be bought. */
  packs: readonly SmsPack[];
  /** Whether this business can buy a pack now: an active plan that is not ending, prices set. */
  packsAvailable: boolean;
}

export async function readBillingState(
  context: AuthenticatedContext,
  orgId: string,
  requestId: string,
): Promise<BillingState> {
  const [entitlement, balance] = await Promise.all([
    context.db
      .from("entitlement_snapshots")
      .select("plan_id, status, cancel_at_period_end, trial_ends_at, current_period_end")
      .eq("org_id", orgId)
      .maybeSingle(),
    // As the signed-in owner, so the function's own membership check applies.
    context.db.rpc("rpc_sms_balance", { p_org_id: orgId }),
  ]);

  if (entitlement.error) {
    logger.error("billing.state_failed", { requestId, orgId, error: entitlement.error });
    throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
  }

  if (balance.error) {
    // A failed balance lookup must not masquerade as "zero SMS credits".
    logger.error("billing.balance_failed", { requestId, orgId, error: balance.error });
    throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
  }

  const row = entitlement.data as {
    plan_id: PlanId | null;
    status: string;
    cancel_at_period_end: boolean;
    trial_ends_at: string | null;
    current_period_end: string | null;
  } | null;

  // Every number here comes from the backend. Nothing in the UI may invent a
  // plan, a trial length, or a balance when this is missing.
  const balanceRow = Array.isArray(balance.data)
    ? (balance.data[0] as { monthly: number; purchased: number; total: number } | undefined)
    : undefined;

  // A stored `trialing` is a claim about a date, and the date can have passed.
  // The owner is shown the status that governs, not the one last written.
  const status = row
    ? effectiveStatus(row.status as EntitlementStatus, row.trial_ends_at)
    : "suspended";

  return {
    planId: row?.plan_id ?? null,
    status,
    cancelAtPeriodEnd: row?.cancel_at_period_end ?? false,
    trialEndsAt: row?.trial_ends_at ?? null,
    currentPeriodEnd: row?.current_period_end ?? null,
    smsBalance: {
      monthly: Number(balanceRow?.monthly ?? 0),
      purchased: Number(balanceRow?.purchased ?? 0),
      total: Number(balanceRow?.total ?? 0),
    },
    plans: PLANS,
    packs: SMS_PACK_LIST,
    // An active plan that is not ending, with prices configured: the same
    // rule checkout enforces, so the button is never offered and refused.
    packsAvailable:
      status === "active" && !(row?.cancel_at_period_end ?? false) && stripePackPricesConfigured(),
  };
}
