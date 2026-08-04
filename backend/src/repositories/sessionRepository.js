import { query, withTransaction } from '../db/pool.js';

/**
 * Refresh token storage — the device list users actually see.
 *
 * Only the HMAC of each token is persisted, so a database disclosure does not
 * hand an attacker usable sessions. Tokens rotate on every use, and presenting
 * an already-revoked one revokes the entire family: that is the standard
 * detection for a stolen refresh token, since the legitimate client and the
 * thief cannot both hold the current one.
 */

export async function createRefreshToken({
  userId,
  accountId,
  tokenHash,
  expiresAt,
  userAgent = null,
  ipHash = null,
  deviceLabel = null,
  location = null,
  replacedTokenId = null,
}) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO refresh_tokens
         (user_id, account_id, token_hash, expires_at, user_agent,
          ip_hash, device_label, approximate_location)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, expires_at, created_at`,
      [
        userId,
        accountId,
        tokenHash,
        expiresAt,
        userAgent?.slice(0, 400) ?? null,
        ipHash,
        deviceLabel,
        location,
      ],
    );

    // Link the old token to its replacement in the same transaction, so the
    // rotation chain can never be broken by a partial write.
    if (replacedTokenId) {
      await client.query(
        'UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1',
        [replacedTokenId, rows[0].id],
      );
    }

    return rows[0];
  });
}

/** Returns revoked and expired tokens too — the caller decides what that means. */
export async function findRefreshToken(tokenHash) {
  const { rows } = await query(
    `SELECT id, user_id, account_id, expires_at, revoked_at, replaced_by
       FROM refresh_tokens WHERE token_hash = $1`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function touchRefreshToken(tokenId) {
  await query('UPDATE refresh_tokens SET last_used_at = now() WHERE id = $1', [tokenId]);
}

/**
 * Every device currently signed in.
 *
 * `is_current` lets the UI label the requesting device, so nobody signs
 * themselves out by accident while trying to remove a suspicious one.
 */
export async function listActiveSessions(userId, currentTokenHash = null) {
  const { rows } = await query(
    `SELECT id, device_label, approximate_location, user_agent,
            created_at, last_used_at, expires_at,
            (token_hash = $2) AS is_current
       FROM refresh_tokens
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND expires_at > now()
      ORDER BY last_used_at DESC`,
    [userId, currentTokenHash],
  );
  return rows;
}

/** Scoped by user, so one account can never end another's session. */
export async function revokeSessionForUser(userId, sessionId) {
  const { rowCount } = await query(
    `UPDATE refresh_tokens SET revoked_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [sessionId, userId],
  );
  return rowCount > 0;
}

export async function revokeUserTokens(userId) {
  const { rowCount } = await query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
  return rowCount;
}

/**
 * Revoke everything except the caller's own session.
 *
 * "Sign out everywhere else" is what a user actually wants when they suspect
 * compromise — signing themselves out too just adds a login they did not ask
 * for at the moment they are already anxious.
 */
export async function revokeOtherSessions(userId, currentTokenHash) {
  const { rowCount } = await query(
    `UPDATE refresh_tokens SET revoked_at = now()
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND token_hash IS DISTINCT FROM $2`,
    [userId, currentTokenHash],
  );
  return rowCount;
}

/**
 * Housekeeping.
 *
 * Revoked rows are kept for 30 days rather than deleted immediately: they are
 * the evidence that a token was rotated or a family was revoked, which is what
 * an incident investigation reads.
 */
export async function purgeExpiredTokens() {
  const { rowCount } = await query(
    `DELETE FROM refresh_tokens
      WHERE expires_at < now() - interval '30 days'
         OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days')`,
  );
  return rowCount;
}
