import { query } from '../db/pool.js';

/**
 * Billing state and usage metering.
 *
 * Not under RLS: Stripe webhooks arrive with no tenant context and must be able
 * to resolve an account from a Stripe identifier before one exists.
 */

export async function getSubscription(accountId) {
  const { rows } = await query(
    `SELECT account_id, stripe_customer_id, stripe_subscription_id, status, plan,
            monthly_sms_allowance, trial_ends_at, current_period_end, cancel_at_period_end
       FROM billing_subscriptions WHERE account_id = $1`,
    [accountId],
  );
  return rows[0] ?? null;
}

export async function findAccountByStripeSubscription(subscriptionId) {
  if (!subscriptionId) return null;
  const { rows } = await query(
    'SELECT account_id FROM billing_subscriptions WHERE stripe_subscription_id = $1',
    [subscriptionId],
  );
  return rows[0]?.account_id ?? null;
}

export async function findAccountByStripeCustomer(customerId) {
  if (!customerId) return null;
  const { rows } = await query(
    'SELECT account_id FROM billing_subscriptions WHERE stripe_customer_id = $1',
    [customerId],
  );
  return rows[0]?.account_id ?? null;
}

export async function attachStripeCustomer(accountId, customerId) {
  await query(
    'UPDATE billing_subscriptions SET stripe_customer_id = $2, updated_at = now() WHERE account_id = $1',
    [accountId, customerId],
  );
}

/**
 * Apply a subscription state change.
 *
 * Every field is COALESCE'd against its current value, so a partial event
 * cannot blank out fields it did not carry. Stripe delivers webhooks at least
 * once and out of order, so this has to be safe to replay.
 */
export async function applySubscriptionState({
  accountId,
  stripeSubscriptionId = null,
  stripeCustomerId = null,
  status = null,
  plan = null,
  monthlySmsAllowance = null,
  currentPeriodEnd = null,
  cancelAtPeriodEnd = null,
}) {
  const { rows } = await query(
    `UPDATE billing_subscriptions
        SET stripe_subscription_id = COALESCE($2, stripe_subscription_id),
            stripe_customer_id     = COALESCE($3, stripe_customer_id),
            status                 = COALESCE($4::subscription_status, status),
            plan                   = COALESCE($5, plan),
            monthly_sms_allowance  = COALESCE($6, monthly_sms_allowance),
            current_period_end     = COALESCE($7, current_period_end),
            cancel_at_period_end   = COALESCE($8, cancel_at_period_end),
            updated_at             = now()
      WHERE account_id = $1
      RETURNING account_id, status, plan, current_period_end`,
    [
      accountId,
      stripeSubscriptionId,
      stripeCustomerId,
      status,
      plan,
      monthlySmsAllowance,
      currentPeriodEnd,
      cancelAtPeriodEnd,
    ],
  );
  return rows[0] ?? null;
}

/**
 * Claim a Stripe event id before processing.
 *
 * Returns false when it was already handled. This is what makes webhook
 * handling exactly-once despite at-least-once delivery.
 */
export async function claimStripeEvent(eventId, eventType) {
  const { rowCount } = await query(
    'INSERT INTO stripe_events (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
    [eventId, eventType],
  );
  return rowCount === 1;
}

/** Released on a processing failure so Stripe's retry can try again. */
export async function releaseStripeEvent(eventId) {
  await query('DELETE FROM stripe_events WHERE id = $1', [eventId]);
}

export async function claimProviderEvent(eventId, provider) {
  const { rowCount } = await query(
    'INSERT INTO provider_webhook_events (id, provider) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
    [eventId, provider],
  );
  return rowCount === 1;
}

// ------------------------------------------------------------------ usage --

/** Atomic. Returns false when the plan allowance is exhausted. */
export async function reserveQuota(accountId, count) {
  const { rows } = await query('SELECT reserve_message_quota($1, $2) AS allowed', [
    accountId,
    count,
  ]);
  return rows[0]?.allowed === true;
}

/** Give quota back when a campaign fails after reserving it. */
export async function releaseQuota(accountId, count) {
  await query(
    `UPDATE usage_daily
        SET messages_sent = GREATEST(0, messages_sent - $2)
      WHERE account_id = $1 AND usage_date = CURRENT_DATE`,
    [accountId, count],
  );
}

export async function recordUsageCost(accountId, segments, cents) {
  await query('SELECT record_usage_cost($1, $2, $3)', [accountId, segments, cents]);
}

export async function getMonthlyUsage(accountId) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(messages_sent), 0)::int AS messages_sent,
            COALESCE(SUM(segments_sent), 0)::int AS segments_sent,
            COALESCE(SUM(cost_in_cents), 0)::int AS cost_in_cents
       FROM usage_daily
      WHERE account_id = $1 AND usage_date >= date_trunc('month', CURRENT_DATE)`,
    [accountId],
  );
  return rows[0];
}

export async function dailyUsage(accountId, days = 30) {
  const { rows } = await query(
    `SELECT usage_date, messages_sent, segments_sent, cost_in_cents
       FROM usage_daily
      WHERE account_id = $1 AND usage_date >= CURRENT_DATE - $2::int
      ORDER BY usage_date`,
    [accountId, days],
  );
  return rows;
}

/**
 * Lock accounts whose trial has elapsed.
 *
 * The third leg of the kill switch: Stripe has no event for "a trial you never
 * attached a card to just ended", so nothing else would catch these.
 */
export async function expireLapsedTrials() {
  const { rows } = await query(
    `UPDATE billing_subscriptions
        SET status = 'past_due', updated_at = now()
      WHERE status = 'trialing'
        AND trial_ends_at IS NOT NULL
        AND trial_ends_at < now()
      RETURNING account_id`,
  );
  return rows.map((row) => row.account_id);
}
