import { logger } from "@/lib/server/logger";
import { captureException } from "@/lib/server/sentry";
import { getStripe, stripeWebhookSecret, isStripeConfigured } from "@/lib/server/billing/stripe";
import { getPlanByPriceId } from "@/lib/server/billing/plans";
import { serviceRoleClient } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isStripeConfigured()) {
    return new Response("Stripe is not configured", { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const rawBody = await request.text();

  let event;
  try {
    const stripe = await getStripe();
    event = stripe.webhooks.constructEvent(rawBody, signature, stripeWebhookSecret());
  } catch (err) {
    logger.warn("stripe.webhook_signature_failed", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return new Response("Webhook signature verification failed", { status: 400 });
  }

  const alreadyProcessed = await checkEventIdempotency(event.id);
  if (alreadyProcessed) {
    logger.info("stripe.webhook_duplicate", { eventId: event.id, type: event.type });
    return new Response("ok", { status: 200 });
  }

  try {
    await handleStripeEvent(event);
    await recordEventProcessed(event.id, event.type);
  } catch (err) {
    logger.error("stripe.webhook_handler_failed", {
      eventType: event.type,
      eventId: event.id,
      error: err,
    });
    captureException(err, { stripeEventType: event.type, stripeEventId: event.id });
    return new Response("Webhook handler error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}

async function checkEventIdempotency(eventId: string): Promise<boolean> {
  const db = serviceRoleClient();
  const { data, error } = await db
    .from("stripe_webhook_events")
    .select("event_id")
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) {
    throw new Error(`Idempotency check failed: ${error.message}`);
  }
  return data !== null;
}

async function recordEventProcessed(eventId: string, eventType: string): Promise<void> {
  const db = serviceRoleClient();
  const { error } = await db.from("stripe_webhook_events").upsert(
    { event_id: eventId, event_type: eventType, processed_at: new Date().toISOString() },
    { onConflict: "event_id" },
  );
  if (error) {
    throw new Error(`Failed to record processed event: ${error.message}`);
  }
}

async function handleStripeEvent(event: import("stripe").default.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object);
      break;

    case "customer.subscription.updated":
      await handleSubscriptionUpdated(event.data.object);
      break;

    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object);
      break;

    case "invoice.payment_failed":
      await handlePaymentFailed(event.data.object);
      break;

    default:
      logger.info("stripe.webhook_unhandled", { type: event.type });
  }
}

function resolveCustomerId(customer: string | { id: string } | null | undefined): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

async function upsertSubscription(
  orgId: string,
  subscription: import("stripe").default.Subscription,
): Promise<void> {
  const priceId = subscription.items.data[0]?.price.id;
  const plan = priceId ? getPlanByPriceId(priceId) : undefined;

  if (priceId && !plan) {
    logger.error("stripe.unknown_price_id", { orgId, priceId, subscriptionId: subscription.id });
    throw new Error(`Unknown Stripe Price ID: ${priceId}. Refusing to map to a plan.`);
  }

  const planId = plan?.id ?? "starter";
  const customerId = resolveCustomerId(subscription.customer);

  const db = serviceRoleClient();

  if (customerId) {
    const { data: conflicting } = await db
      .from("subscriptions")
      .select("org_id")
      .eq("stripe_customer_id", customerId)
      .neq("org_id", orgId)
      .maybeSingle();
    if (conflicting) {
      logger.error("stripe.cross_org_customer", {
        orgId,
        conflictingOrgId: conflicting.org_id,
        customerId,
      });
      throw new Error(`Stripe customer ${customerId} already mapped to a different org`);
    }
  }

  const { error: subError } = await db.from("subscriptions").upsert(
    {
      org_id: orgId,
      plan_id: planId,
      status: subscription.status,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceId ?? null,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at: subscription.cancel_at
        ? new Date(subscription.cancel_at * 1000).toISOString()
        : null,
    },
    { onConflict: "org_id" },
  );

  if (subError) {
    logger.error("stripe.upsert_subscription_failed", { orgId, error: subError });
    throw subError;
  }

  const entitlementStatus =
    subscription.status === "active" || subscription.status === "trialing"
      ? "active"
      : subscription.status === "canceled"
        ? "cancelled"
        : "past_due";

  const { error: entError } = await db.rpc("rpc_apply_entitlement_snapshot", {
    p_org_id: orgId,
    p_plan_id: planId,
    p_status: entitlementStatus,
    p_source: "stripe",
    p_stripe_customer_id: customerId,
    p_stripe_subscription_id: subscription.id,
  });

  if (entError) {
    logger.error("stripe.apply_entitlement_failed", { orgId, error: entError });
    throw entError;
  }

  logger.info("stripe.subscription_synced", {
    orgId,
    planId,
    status: subscription.status,
    subscriptionId: subscription.id,
  });
}

async function handleCheckoutCompleted(
  session: import("stripe").default.Checkout.Session,
): Promise<void> {
  const orgId = session.metadata?.org_id;
  const subscriptionId = session.subscription;

  if (!orgId || !subscriptionId) {
    throw new Error(
      `checkout.session.completed missing required metadata: org_id=${orgId ?? "null"}, subscription=${subscriptionId ?? "null"}, sessionId=${session.id}`,
    );
  }

  const stripe = await getStripe();
  const subscription = await stripe.subscriptions.retrieve(
    typeof subscriptionId === "string" ? subscriptionId : subscriptionId.id,
  );

  await upsertSubscription(orgId, subscription);
}

async function resolveOrgId(subscription: import("stripe").default.Subscription): Promise<string | null> {
  const fromMetadata = subscription.metadata?.org_id;
  if (fromMetadata) return fromMetadata;

  const db = serviceRoleClient();
  const { data, error } = await db
    .from("subscriptions")
    .select("org_id")
    .eq("stripe_subscription_id", subscription.id)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to look up org for subscription ${subscription.id}: ${error.message}`);
  }
  return data?.org_id ?? null;
}

async function handleSubscriptionUpdated(
  subscription: import("stripe").default.Subscription,
): Promise<void> {
  const orgId = await resolveOrgId(subscription);
  if (!orgId) {
    logger.warn("stripe.subscription_update_no_org", { subscriptionId: subscription.id });
    return;
  }

  await upsertSubscription(orgId, subscription);
}

async function handleSubscriptionDeleted(
  subscription: import("stripe").default.Subscription,
): Promise<void> {
  const orgId = await resolveOrgId(subscription);
  if (!orgId) {
    logger.warn("stripe.subscription_delete_no_org", { subscriptionId: subscription.id });
    return;
  }

  const db = serviceRoleClient();

  const { error: subError } = await db
    .from("subscriptions")
    .update({ status: "canceled", cancel_at: new Date().toISOString() })
    .eq("org_id", orgId);

  if (subError) {
    logger.error("stripe.delete_subscription_failed", { orgId, error: subError });
    throw subError;
  }

  const { error: entError } = await db.rpc("rpc_apply_entitlement_snapshot", {
    p_org_id: orgId,
    p_plan_id: "starter",
    p_status: "cancelled",
    p_source: "stripe",
    p_stripe_customer_id: resolveCustomerId(subscription.customer),
    p_stripe_subscription_id: subscription.id,
  });

  if (entError) {
    logger.error("stripe.revert_entitlement_failed", { orgId, error: entError });
    throw entError;
  }

  logger.info("stripe.subscription_cancelled", { orgId, subscriptionId: subscription.id });
}

async function handlePaymentFailed(
  invoice: import("stripe").default.Invoice,
): Promise<void> {
  const subscriptionId = invoice.subscription;

  logger.warn("stripe.payment_failed", {
    invoiceId: invoice.id,
    subscriptionId: typeof subscriptionId === "string" ? subscriptionId : subscriptionId?.id,
    attemptCount: invoice.attempt_count,
  });

  if (!subscriptionId) return;

  if ((invoice.attempt_count ?? 0) >= 3) {
    const stripe = await getStripe();
    const subscription = await stripe.subscriptions.retrieve(
      typeof subscriptionId === "string" ? subscriptionId : subscriptionId.id,
    );

    const orgId = subscription.metadata?.org_id;
    if (orgId) {
      const db = serviceRoleClient();
      const { error } = await db.rpc("rpc_apply_entitlement_snapshot", {
        p_org_id: orgId,
        p_plan_id: "starter",
        p_status: "past_due",
        p_source: "stripe",
        p_stripe_customer_id: resolveCustomerId(subscription.customer),
        p_stripe_subscription_id: subscription.id,
      });

      if (error) {
        logger.error("stripe.payment_failed_downgrade_error", { orgId, error });
        throw error;
      }

      logger.warn("stripe.payment_failed_downgrade", { orgId, attemptCount: invoice.attempt_count });
    }
  }
}
