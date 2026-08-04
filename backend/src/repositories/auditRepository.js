import { query, withTenant } from '../db/pool.js';
import { logger } from '../logger.js';

/**
 * Append-only audit trail of business actions.
 *
 * Distinct from `security_events`, which records authentication. This answers
 * "who changed what", which is the question an enterprise customer's security
 * questionnaire actually asks.
 *
 * Recording an audit event must never fail the operation it describes — a
 * campaign that sent successfully but could not be logged still sent — so
 * write failures are logged and swallowed.
 */

export async function record({
  accountId,
  actorUserId = null,
  action,
  targetType = null,
  targetId = null,
  metadata = {},
  ipHash = null,
}) {
  if (!accountId) return;

  try {
    await withTenant(accountId, (client) =>
      client.query(
        `INSERT INTO audit_events
           (account_id, actor_user_id, action, target_type, target_id, metadata, ip_hash)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          accountId,
          actorUserId,
          action,
          targetType,
          targetId ? String(targetId) : null,
          JSON.stringify(metadata ?? {}),
          ipHash,
        ],
      ),
    );
  } catch (error) {
    logger.error('audit.write_failed', { action, message: error.message });
  }
}

export async function list(accountId, { limit = 100, offset = 0 } = {}) {
  return withTenant(accountId, async (client) => {
    const { rows } = await client.query(
      `SELECT e.id, e.action, e.target_type, e.target_id, e.metadata, e.created_at,
              u.email AS actor_email
         FROM audit_events e
         LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.account_id = $1
        ORDER BY e.created_at DESC
        LIMIT $2 OFFSET $3`,
      [accountId, Math.min(limit, 500), offset],
    );
    return rows;
  });
}

// ------------------------------------------------------- IP allowlisting ---

/**
 * Is this address permitted for the account?
 *
 * Fails open on error. The allowlist is defence in depth layered on top of
 * authentication, and a lookup failure must not lock a paying customer out of
 * their own dashboard.
 */
export async function isIpAllowed(accountId, ip) {
  if (!ip) return true;

  try {
    const { rows } = await query('SELECT ip_is_allowed($1, $2::inet) AS allowed', [accountId, ip]);
    return rows[0]?.allowed !== false;
  } catch (error) {
    logger.error('security.ip_check_failed', { message: error.message });
    return true;
  }
}

export async function listAllowlist(accountId) {
  return withTenant(accountId, async (client) => {
    const entries = await client.query(
      `SELECT id, cidr::text AS cidr, label, created_at
         FROM account_ip_allowlist WHERE account_id = $1 ORDER BY created_at`,
      [accountId],
    );

    const account = await client.query('SELECT ip_allowlist_enabled FROM accounts WHERE id = $1', [
      accountId,
    ]);

    return {
      enabled: account.rows[0]?.ip_allowlist_enabled === true,
      entries: entries.rows,
    };
  });
}

export async function addAllowlistEntry(accountId, { cidr, label, userId }) {
  return withTenant(accountId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO account_ip_allowlist (account_id, cidr, label, created_by)
       VALUES ($1, $2::cidr, $3, $4)
       ON CONFLICT (account_id, cidr) DO UPDATE SET label = EXCLUDED.label
       RETURNING id, cidr::text AS cidr, label, created_at`,
      [accountId, cidr, label ?? null, userId ?? null],
    );
    return rows[0];
  });
}

export async function removeAllowlistEntry(accountId, entryId) {
  return withTenant(accountId, async (client) => {
    const { rowCount } = await client.query(
      'DELETE FROM account_ip_allowlist WHERE account_id = $1 AND id = $2',
      [accountId, entryId],
    );
    return rowCount > 0;
  });
}

export async function countAllowlistEntries(accountId) {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS count FROM account_ip_allowlist WHERE account_id = $1',
    [accountId],
  );
  return rows[0].count;
}

export async function setAllowlistEnabled(accountId, enabled) {
  const { rows } = await query(
    'UPDATE accounts SET ip_allowlist_enabled = $2 WHERE id = $1 RETURNING ip_allowlist_enabled',
    [accountId, enabled],
  );
  return rows[0]?.ip_allowlist_enabled === true;
}
