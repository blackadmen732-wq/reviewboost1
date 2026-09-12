import { logger } from "@/lib/server/logger";
import { captureException } from "@/lib/server/sentry";
import { getStripe, stripeWebhookSecret, isStripeConfigured } from "@/lib/server/billing/stripe";
import { getPlanByPriceId } from "@/lib/server/billing/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook endpoint.
 *
 * Signature verification is mandatory — an unverified webhook is a direct path
 * to granting arbitrary plans. The raw body must be read before JSON parsing,
 * because Stripe's signature covers the raw bytes.
 */
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

  try {
    await handleStripeEvent(event);
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

async function handleCheckoutCompleted(
  session: import("stripe").default.Checkout.Session,
): Promise<void> {
  const orgId = session.metadata?.org_id;
  const subscriptionId = session.subscription;

  if (!orgId || !subscriptionId) {
    logger.warn("stripe.checkout_missing_metadata", {
      sessionId: session.id,
      hasOrgId: Boolean(orgId),
      hasSubscription: Boolean(subscriptionId),
    });
    return;
  }

  logger.info("stripe.checkout_completed", {
    orgId,
    subscriptionId: typeof subscriptionId === "string" ? subscriptionId : subscriptionId.id,
  });

  // TODO: Upsert subscription record in the database.
  // The subscription table should store:
  //   org_id, stripe_customer_id, stripe_subscription_id, plan_id, status, current_period_end
  // This is the point where the entitlement projection gets updated.
}

async function handleSubscriptionUpdated(
  subscription: import("stripe").default.Subscription,
): Promise<void> {
  const orgId = subscription.metadata?.org_id;
  if (!orgId) {
    logger.warn("stripe.subscription_update_no_org", { subscriptionId: subscription.id });
    return;
  }

  const priceId = subscription.items.data[0]?.price.id;
  const plan = priceId ? getPlanByPriceId(priceId) : undefined;

  logger.info("stripe.subscription_updated", {
    orgId,
    subscriptionId: subscription.id,
    status: subscription.status,
    planId: plan?.id ?? "unknown",
  });

  // TODO: Update subscription record and entitlement projection.
  // When downgrading: preserve data, disable capabilities that exceed the
  // new plan's limits. Never delete tags, locations, or feedback.
}

async function handleSubscriptionDeleted(
  subscription: import("stripe").default.Subscription,
): Promise<void> {
  const orgId = subscription.metadata?.org_id;
  if (!orgId) return;

  logger.info("stripe.subscription_deleted", {
    orgId,
    subscriptionId: subscription.id,
  });

  // TODO: Revert org to free/starter tier.
  // Preserve all data, tags, NFC hardware identity, QR codes, feedback.
  // Disable paid capabilities only.
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

  // TODO: After N failed attempts, downgrade to starter.
  // Send notification to org owners about payment failure.
}
