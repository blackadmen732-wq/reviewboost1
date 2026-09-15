import "server-only";

import type Stripe from "stripe";

import type { AuthenticatedContext } from "@/lib/server/auth";
import {
  effectiveStatus,
  type EntitlementStatus,
  PLANS,
  type PlanId,
  TRIAL_DAYS,
} from "@/lib/server/entitlements";
import { planIdForPrice, publicFrontendUrl, stripePriceId } from "@/lib/server/env";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { logger } from "@/lib/server/logger";
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
 * Seven days, no charge, a card required up front, and a paid plan chosen
 * before it starts. One location, one Tag, and no SMS at all. There is no
 * permanent free plan and no "we'll figure out the plan later" state — a trial
 * without a chosen plan is a subscription nobody knows how to renew.
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

/**
 * The price an invoice was for.
 *
 * Stripe moved this. Through the 2025 API versions a line item carried
 * `price`; from `2026-08-26.dahlia` it carries `pricing.price_details.price`,
 * which is a price id or an expanded Price. Reading only the old shape does
 * not fail loudly — `planIdForPrice` is handed null, the invoice mints no
 * monthly allowance, and a business that paid gets no SMS with no error
 * anywhere. Both shapes are read, newest first, and a subscription line's own
 * price is the last resort.
 */
function invoicePriceId(invoice: Stripe.Invoice): string | null {
  const line = invoice.lines?.data?.[0] as
    | {
        pricing?: { price_details?: { price?: string | { id?: string } } };
        price?: { id?: string } | string;
        plan?: { id?: string };
      }
    | undefined;
  if (!line) return null;

  const fromPricing = line.pricing?.price_details?.price;
  if (typeof fromPricing === "string") return fromPricing;
  if (fromPricing?.id) return fromPricing.id;

  if (typeof line.price === "string") return line.price;
  if (line.price?.id) return line.price.id;

  // Older still: a subscription line reported its plan rather than its price.
  return line.plan?.id ?? null;
}

function customerIdOf(value: string | { id: string } | null | undefined): string | null {
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

  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      // A card is required before the trial starts. A trial that can be taken
      // without one is a free plan with a timer.
      payment_method_collection: "always",
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
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

  const { data: existing, error } = await service
    .from("billing_customers")
    .select("stripe_customer_id")
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) throw error;

  const found = (existing as { stripe_customer_id?: string } | null)?.stripe_customer_id;
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

// ------------------------------------------------------------- webhooks ----

export type EventOutcome =
  | "applied"
  | "stale"
  | "duplicate"
  | "ignored"
  | "unknown_customer";

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
      const orgId = await orgForCustomer(customerIdOf(subscription.customer));
      if (!orgId) return "unknown_customer";

      const fields = subscriptionFields(subscription);
      const planId =
        planIdForPrice(fields.priceId) ??
        ((subscription.metadata?.["plan_id"] as PlanId | undefined) ?? null);

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

      if (error) throw error;
      return data === "stale" ? "stale" : "applied";
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const orgId = await orgForCustomer(customerIdOf(invoice.customer));
      if (!orgId) return "unknown_customer";

      const line = invoice.lines?.data?.[0];

      // THE ONLY THING THAT MINTS MONTHLY SMS. Not checkout, not subscription
      // creation: a paid invoice for a billing period, once, expiring at the
      // end of the period it paid for.
      const { error } = await service.rpc("rpc_billing_apply_invoice_paid", {
        p_org_id: orgId,
        p_invoice_id: invoice.id,
        p_plan_id: planIdForPrice(invoicePriceId(invoice)),
        p_period_start: unixToIso(line?.period?.start),
        p_period_end: unixToIso(line?.period?.end),
        p_amount_paid: invoice.amount_paid ?? 0,
      });

      if (error) throw error;
      return "applied";
    }

    case "invoice.payment_failed": {
      // Deliberately nothing here. A failed invoice mints no allowance, and
      // the entitlement change that follows arrives as a subscription update
      // with Stripe's own status — inferring `past_due` from a failure would
      // race that event and could contradict it.
      return "ignored";
    }

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
    if (outcome !== "unknown_customer") {
      await service.rpc("rpc_stripe_event_complete", { p_event_id: event.id });
    } else {
      // Left unprocessed on purpose: an event whose customer we cannot place
      // is visible in the inbox for someone to look at, not silently dropped.
      await service.rpc("rpc_stripe_event_fail", {
        p_event_id: event.id,
        p_error: "no organization for this Stripe customer",
      });
    }
    return { outcome };
  } catch (error) {
    await service.rpc("rpc_stripe_event_fail", {
      p_event_id: event.id,
      p_error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
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
    serviceRoleClient().rpc("rpc_sms_balance", { p_org_id: orgId }),
  ]);

  if (entitlement.error) {
    logger.error("billing.state_failed", { requestId, orgId, error: entitlement.error });
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
  };
}
