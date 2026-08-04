import Stripe from 'stripe';

import { config } from '../config/index.js';
import { badRequest, serviceUnavailable } from '../http/errors.js';
import { logger } from '../logger.js';
import * as billing from '../repositories/billingRepository.js';

/**
 * Stripe billing and the subscription kill switch.
 *
 * The kill switch is enforced in three independent places, because a single
 * check is a single point of failure for revenue:
 *
 *   1. `requireActiveSubscription` on every route that costs money
 *   2. a re-check in the campaign worker, and again in the SMS worker before
 *      each individual send — a subscription can lapse between a campaign being
 *      created and its messages going out
 *   3. `expireLapsedTrials` in the maintenance job, for accounts Stripe never
 *      sends an event about because no card was ever attached
 */

export const ACTIVE_STATUSES = new Set(['trialing', 'active']);

/** Defined in code rather than the database, so pricing is reviewable in a diff. */
export const PLANS = Object.freeze({
  starter: { monthlySmsAllowance: 500, priceInCents: 4900 },
  growth: { monthlySmsAllowance: 2500, priceInCents: 14900 },
  scale: { monthlySmsAllowance: 10000, priceInCents: 39900 },
});

let stripeClient = null;

function getStripe() {
  if (!config.stripeConfigured) {
    throw serviceUnavailable('billing_unavailable', 'Billing is not configured on this server.');
  }
  stripeClient ??= new Stripe(config.stripeSecretKey, { apiVersion: '2024-06-20' });
  return stripeClient;
}

export function isSubscriptionActive(subscription) {
  if (!subscription) return false;
  if (!ACTIVE_STATUSES.has(subscription.status)) return false;

  // A trial that has elapsed is not active, even if no webhook has arrived yet.
  if (subscription.status === 'trialing' && subscription.trial_ends_at) {
    return new Date(subscription.trial_ends_at).getTime() > Date.now();
  }

  return true;
}

// -------------------------------------------------------------- checkout ---

export async function createCheckoutSession({ accountId, email, successUrl, cancelUrl }) {
  const stripe = getStripe();
  const existing = await billing.getSubscription(accountId);

  let customerId = existing?.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({ email, metadata: { account_id: accountId } });
    customerId = customer.id;
    await billing.attachStripeCustomer(accountId, customerId);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: config.stripePriceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    // Present on every subsequent subscription event, so the tenant is
    // resolvable even if the customer mapping is somehow missing.
    subscription_data: { metadata: { account_id: accountId } },
    client_reference_id: accountId,
  });

  return { url: session.url, sessionId: session.id };
}

export async function createPortalSession({ accountId, returnUrl }) {
  const stripe = getStripe();
  const subscription = await billing.getSubscription(accountId);

  if (!subscription?.stripe_customer_id) {
    throw badRequest('no_customer', 'This account has no billing profile yet.');
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripe_customer_id,
    return_url: returnUrl,
  });

  return { url: session.url };
}

export function constructWebhookEvent(rawBody, signature) {
  return getStripe().webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);
}

// -------------------------------------------------------------- webhooks ---

/**
 * Resolve the account a Stripe event belongs to.
 *
 * This is the single most common way a Stripe integration silently breaks. For
 * `invoice.*` events, `event.data.object` is an **Invoice**, so its `.id` is
 * `in_…` — using it to look up a subscription matches zero rows, and payment
 * failures then never lock anyone out. Nothing errors; revenue just quietly
 * stops being enforced.
 *
 * Resolution order: subscription id, then the invoice's subscription reference
 * (which moved location in the 2025 API versions), then customer, then metadata.
 */
async function resolveAccount(event) {
  const object = event.data.object;

  const subscriptionId =
    object.object === 'subscription'
      ? object.id
      : (typeof object.subscription === 'string' ? object.subscription : null) ??
        object.parent?.subscription_details?.subscription ??
        null;

  const customerId = typeof object.customer === 'string' ? object.customer : null;

  if (subscriptionId) {
    const accountId = await billing.findAccountByStripeSubscription(subscriptionId);
    if (accountId) return { accountId, subscriptionId, customerId };
  }

  if (customerId) {
    const accountId = await billing.findAccountByStripeCustomer(customerId);
    if (accountId) return { accountId, subscriptionId, customerId };
  }

  const metadataAccount =
    object.metadata?.account_id ??
    object.subscription_details?.metadata?.account_id ??
    object.parent?.subscription_details?.metadata?.account_id ??
    null;

  return { accountId: metadataAccount, subscriptionId, customerId };
}

/** Anything unexpected is treated as incomplete rather than active. */
function mapStripeStatus(status) {
  switch (status) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    default:
      return 'incomplete';
  }
}

function planFromSubscription(subscription) {
  const nickname = String(subscription.items?.data?.[0]?.price?.nickname ?? '').toLowerCase();
  if (PLANS[nickname]) return { plan: nickname, allowance: PLANS[nickname].monthlySmsAllowance };
  return { plan: 'starter', allowance: PLANS.starter.monthlySmsAllowance };
}

function periodEnd(subscription) {
  const seconds =
    subscription.current_period_end ?? subscription.items?.data?.[0]?.current_period_end ?? null;
  return seconds ? new Date(seconds * 1000) : null;
}

/**
 * Apply one Stripe event.
 *
 * Throws on failure so the caller returns a non-2xx and Stripe retries.
 * Swallowing the error would leave the account permanently in the wrong billing
 * state, with Stripe believing it was delivered.
 */
export async function handleWebhookEvent(event) {
  const { accountId, subscriptionId, customerId } = await resolveAccount(event);

  if (!accountId) {
    logger.warn('billing.unmatched_event', { type: event.type, eventId: event.id });
    return { handled: false, reason: 'no_matching_account' };
  }

  const object = event.data.object;

  switch (event.type) {
    case 'checkout.session.completed':
      await billing.applySubscriptionState({
        accountId,
        stripeSubscriptionId: typeof object.subscription === 'string' ? object.subscription : null,
        stripeCustomerId: customerId,
        status: 'active',
      });
      break;

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.resumed': {
      const { plan, allowance } = planFromSubscription(object);
      await billing.applySubscriptionState({
        accountId,
        stripeSubscriptionId: object.id,
        stripeCustomerId: customerId,
        status: mapStripeStatus(object.status),
        plan,
        monthlySmsAllowance: allowance,
        currentPeriodEnd: periodEnd(object),
        cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
      });
      break;
    }

    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
      await billing.applySubscriptionState({
        accountId,
        stripeSubscriptionId: object.id,
        status: 'canceled',
        cancelAtPeriodEnd: true,
      });
      break;

    case 'invoice.payment_failed':
      await billing.applySubscriptionState({
        accountId,
        stripeSubscriptionId: subscriptionId,
        status: 'past_due',
      });
      break;

    case 'invoice.payment_succeeded':
    case 'invoice.paid':
      await billing.applySubscriptionState({
        accountId,
        stripeSubscriptionId: subscriptionId,
        status: 'active',
      });
      break;

    default:
      return { handled: false, reason: 'unhandled_type' };
  }

  logger.info('billing.event_applied', { type: event.type, accountId });
  return { handled: true, accountId };
}

/** Exposed for unit tests that exercise resolution without a live Stripe. */
export const __testing = { resolveAccount, mapStripeStatus, planFromSubscription };
