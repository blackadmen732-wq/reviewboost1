import { query } from '../db/pool.js';

/**
 * Brute-force controls, device recognition, and the authentication activity log.
 *
 * These live in Postgres rather than Redis deliberately. The rate limiter
 * degrades to per-process memory when Redis is unavailable, which is an
 * acceptable trade for ordinary traffic but not for the controls standing
 * between an attacker and an account. These must hold during a Redis outage.
 */

/**
 * Record a login outcome and report whether the account is now locked.
 *
 * Keyed on the *target email*, not the caller's address: rate limiting by IP is
 * defeated by spreading attempts across a botnet, whereas counting failures
 * against the account being attacked is not.
 */
export async function recordLoginAttempt({
  email,
  ipHash = null,
  succeeded,
  threshold = 10,
  lockMinutes = 15,
}) {
  const { rows } = await query('SELECT * FROM record_login_attempt($1::citext, $2, $3, $4, $5)', [
    email,
    ipHash,
    succeeded,
    threshold,
    lockMinutes,
  ]);

  return rows[0] ?? { locked: false, locked_until: null, recent_failures: 0 };
}

/** Checked before any password work, so a locked account cannot even be probed. */
export async function getLockout(email) {
  const { rows } = await query(
    'SELECT locked_until FROM users WHERE email = $1::citext AND locked_until > now()',
    [email],
  );
  return rows[0]?.locked_until ?? null;
}

/**
 * Bounded signups per source address.
 *
 * Registration cannot be throttled by email — an attacker varies it freely —
 * so the source address is the only thing that bounds automated account
 * creation. Returns false when the cap is reached.
 */
export async function allowRegistration(ipHash, { max = 5, windowHours = 1 } = {}) {
  const { rows } = await query('SELECT check_registration_rate($1, $2, $3) AS allowed', [
    ipHash,
    max,
    windowHours,
  ]);
  return rows[0]?.allowed === true;
}

/**
 * Record an authentication event, and report whether the device is new.
 *
 * A sign-in from an unrecognised device is the earliest signal a user gets that
 * someone else has their password, so the check and the insert are one
 * statement — two concurrent logins must not both conclude the device is known.
 */
export async function recordSecurityEvent({
  userId = null,
  accountId = null,
  eventType,
  ipHash = null,
  fingerprint = null,
  deviceLabel = null,
  userAgent = null,
  location = null,
  succeeded = true,
  metadata = {},
}) {
  const { rows } = await query(
    `SELECT * FROM record_security_event($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
    [
      userId,
      accountId,
      eventType,
      ipHash,
      fingerprint,
      deviceLabel,
      userAgent,
      location,
      succeeded,
      JSON.stringify(metadata ?? {}),
    ],
  );

  return { isNewDevice: rows[0]?.is_new_device === true };
}

/** Sign-in history for the account activity screen. */
export async function listSecurityEvents(userId, { limit = 50, offset = 0 } = {}) {
  const { rows } = await query(
    `SELECT event_type, device_label, approximate_location, succeeded, created_at
       FROM security_events
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [userId, Math.min(limit, 200), offset],
  );
  return rows;
}

/**
 * Housekeeping for the maintenance job.
 *
 * Attempt records are operational data, not an audit trail — 30 days is long
 * enough to investigate an incident and short enough that the tables stay small
 * under a sustained attack.
 */
export async function purgeOldAttempts() {
  const logins = await query(
    `DELETE FROM login_attempts WHERE attempted_at < now() - interval '30 days'`,
  );
  const registrations = await query(
    `DELETE FROM registration_attempts WHERE attempted_at < now() - interval '7 days'`,
  );
  const events = await query(
    `DELETE FROM security_events WHERE created_at < now() - interval '180 days'`,
  );

  return {
    loginAttempts: logins.rowCount,
    registrationAttempts: registrations.rowCount,
    securityEvents: events.rowCount,
  };
}
