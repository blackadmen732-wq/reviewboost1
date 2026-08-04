import { query } from '../db/pool.js';

/**
 * Single-use verification tokens and the transactional email outbox.
 */

const TOKEN_TTL_MS = {
  email_verification: 24 * 60 * 60 * 1000,
  password_reset: 60 * 60 * 1000,
};

export async function createUserToken({ userId, purpose, tokenHash }) {
  const ttl = TOKEN_TTL_MS[purpose];
  if (!ttl) throw new Error(`Unknown token purpose: ${purpose}`);

  const { rows } = await query(
    `INSERT INTO user_tokens (user_id, purpose, token_hash, expires_at)
     VALUES ($1, $2::user_token_purpose, $3, now() + make_interval(secs => $4))
     RETURNING id, expires_at`,
    [userId, purpose, tokenHash, ttl / 1000],
  );

  return rows[0];
}

/**
 * Redeem a token exactly once.
 *
 * The `consumed_at IS NULL` predicate inside the UPDATE is the entire
 * concurrency control: two simultaneous redemptions of the same reset link
 * cannot both match, so only one can proceed. A read-then-write check would
 * let both through.
 */
export async function consumeUserToken({ tokenHash, purpose }) {
  const { rows } = await query(
    `UPDATE user_tokens
        SET consumed_at = now()
      WHERE token_hash = $1
        AND purpose = $2::user_token_purpose
        AND consumed_at IS NULL
        AND expires_at > now()
      RETURNING user_id`,
    [tokenHash, purpose],
  );

  return rows[0]?.user_id ?? null;
}

/**
 * Invalidate any outstanding tokens of a purpose for a user.
 *
 * Requesting a new reset link must retire the previous one — otherwise an old
 * email sitting in an inbox stays live for its full hour.
 */
export async function invalidateUserTokens({ userId, purpose }) {
  const { rowCount } = await query(
    `UPDATE user_tokens SET consumed_at = now()
      WHERE user_id = $1 AND purpose = $2::user_token_purpose AND consumed_at IS NULL`,
    [userId, purpose],
  );
  return rowCount;
}

export async function purgeExpiredUserTokens() {
  const { rowCount } = await query(
    `DELETE FROM user_tokens
      WHERE expires_at < now() - interval '7 days'
         OR (consumed_at IS NOT NULL AND consumed_at < now() - interval '7 days')`,
  );
  return rowCount;
}

// ---------------------------------------------------------- email outbox ---

export async function enqueueEmail({ toEncrypted, template, payload = {} }) {
  const { rows } = await query(
    `INSERT INTO email_outbox (to_encrypted, template, payload)
     VALUES ($1, $2, $3::jsonb)
     RETURNING id`,
    [toEncrypted, template, JSON.stringify(payload)],
  );
  return rows[0];
}

/**
 * Claim a batch for delivery.
 *
 * `FOR UPDATE SKIP LOCKED` lets several workers drain the outbox concurrently
 * without any of them handing the same message to the provider twice.
 */
export async function claimPendingEmails({ batchSize = 50, maxAttempts = 5 } = {}) {
  const { rows } = await query(
    `UPDATE email_outbox
        SET status = 'sending', attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM email_outbox
         WHERE status = 'pending' AND attempts < $2
         ORDER BY created_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, to_encrypted, template, payload, attempts`,
    [batchSize, maxAttempts],
  );
  return rows;
}

export async function markEmailSent(id) {
  await query(`UPDATE email_outbox SET status = 'sent', sent_at = now() WHERE id = $1`, [id]);
}

/** Returns to 'pending' for another attempt until the cap, then gives up. */
export async function markEmailFailed(id, errorMessage, { maxAttempts = 5 } = {}) {
  await query(
    `UPDATE email_outbox
        SET status = CASE WHEN attempts >= $3 THEN 'failed' ELSE 'pending' END,
            last_error = $2
      WHERE id = $1`,
    [id, String(errorMessage ?? '').slice(0, 500), maxAttempts],
  );
}

export async function outboxStats() {
  const { rows } = await query(
    `SELECT status, COUNT(*)::int AS count FROM email_outbox GROUP BY status`,
  );
  return Object.fromEntries(rows.map((row) => [row.status, row.count]));
}
