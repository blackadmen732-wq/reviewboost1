import { query, withTransaction } from '../db/pool.js';

/**
 * Accounts, users, and memberships.
 *
 * These tables sit outside Row Level Security because they must be readable
 * before a tenant context exists — you cannot scope a login by account when
 * establishing which account the user belongs to *is* the login.
 *
 * Every query here therefore filters explicitly. Nothing in this file may rely
 * on RLS as a safety net.
 */

// ------------------------------------------------------------------ users --

export async function findUserByEmail(email) {
  const { rows } = await query(
    `SELECT id, email, password_hash, full_name, token_version,
            email_verified_at, locked_until, failed_login_count
       FROM users WHERE email = $1::citext`,
    [String(email ?? '').trim()],
  );
  return rows[0] ?? null;
}

/** Deliberately omits password_hash — callers that need it use findUserByEmail. */
export async function findUserById(userId) {
  const { rows } = await query(
    `SELECT id, email, full_name, token_version, email_verified_at,
            last_login_at, password_changed_at, locked_until
       FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function markEmailVerified(userId) {
  const { rows } = await query(
    `UPDATE users SET email_verified_at = COALESCE(email_verified_at, now())
      WHERE id = $1 RETURNING id, email_verified_at`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function recordLogin(userId) {
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
}

/** Bumping the version retires every access token issued before now. */
export async function bumpTokenVersion(userId) {
  const { rows } = await query(
    'UPDATE users SET token_version = token_version + 1 WHERE id = $1 RETURNING token_version',
    [userId],
  );
  return rows[0]?.token_version ?? null;
}

/**
 * Change a password and invalidate everything issued under the old one.
 *
 * One transaction, because a password changed without its sessions revoked
 * leaves an attacker logged in — which is precisely the case the user was
 * trying to fix.
 */
export async function updatePassword(userId, passwordHash) {
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE users
          SET password_hash = $2,
              password_changed_at = now(),
              token_version = token_version + 1
        WHERE id = $1`,
      [userId, passwordHash],
    );

    const { rowCount } = await client.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );

    return { sessionsRevoked: rowCount };
  });
}

// --------------------------------------------------------------- signup ----

/**
 * Create the account, its first user, the owner membership, and a trialing
 * subscription atomically.
 *
 * A partial signup leaves an account nobody can log into, or a user with no
 * account — both require manual repair, so all four rows land together or none
 * do.
 */
export async function createAccountWithOwner({
  businessName,
  slug,
  googleReviewUrl,
  timezone,
  email,
  passwordHash,
  fullName,
  trialDays,
  monthlySmsAllowance,
}) {
  return withTransaction(async (client) => {
    const account = await client.query(
      `INSERT INTO accounts (business_name, slug, google_review_url, timezone)
       VALUES ($1, $2, $3, $4)
       RETURNING id, business_name, slug, google_review_url, timezone, created_at`,
      [businessName, slug, googleReviewUrl, timezone],
    );

    const user = await client.query(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1::citext, $2, $3)
       RETURNING id, email, full_name, token_version, email_verified_at`,
      [email, passwordHash, fullName ?? null],
    );

    await client.query(
      `INSERT INTO account_members (account_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [account.rows[0].id, user.rows[0].id],
    );

    await client.query(
      `INSERT INTO billing_subscriptions
         (account_id, status, trial_ends_at, monthly_sms_allowance)
       VALUES ($1, 'trialing', now() + make_interval(days => $2), $3)`,
      [account.rows[0].id, trialDays, monthlySmsAllowance],
    );

    return { account: account.rows[0], user: user.rows[0] };
  });
}

export async function slugExists(slug) {
  const { rows } = await query('SELECT 1 FROM accounts WHERE slug = $1', [slug]);
  return rows.length > 0;
}

// ---------------------------------------------------------- memberships ----

export async function listMembershipsForUser(userId) {
  const { rows } = await query(
    `SELECT m.account_id, m.role, a.business_name, a.slug, a.google_review_url, a.timezone
       FROM account_members m
       JOIN accounts a ON a.id = m.account_id
      WHERE m.user_id = $1
      ORDER BY a.created_at`,
    [userId],
  );
  return rows;
}

/**
 * Resolve one membership.
 *
 * This is the authorisation boundary for every authenticated request: a user
 * may only act inside an account they are a member of. Re-read per request
 * rather than trusted from the token, so a removed member loses access
 * immediately instead of at token expiry.
 */
export async function findMembership(userId, accountId) {
  const { rows } = await query(
    `SELECT m.account_id, m.user_id, m.role,
            a.business_name, a.slug, a.google_review_url, a.timezone,
            a.ip_allowlist_enabled,
            b.status AS subscription_status, b.trial_ends_at, b.current_period_end,
            b.monthly_sms_allowance, b.plan
       FROM account_members m
       JOIN accounts a ON a.id = m.account_id
       LEFT JOIN billing_subscriptions b ON b.account_id = m.account_id
      WHERE m.user_id = $1 AND m.account_id = $2`,
    [userId, accountId],
  );
  return rows[0] ?? null;
}

export async function listMembers(accountId) {
  const { rows } = await query(
    `SELECT u.id, u.email, u.full_name, u.last_login_at, u.email_verified_at,
            m.role, m.created_at
       FROM account_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.account_id = $1
      ORDER BY m.created_at`,
    [accountId],
  );
  return rows;
}

export async function upsertMember({ accountId, userId, role }) {
  const { rows } = await query(
    `INSERT INTO account_members (account_id, user_id, role)
     VALUES ($1, $2, $3::user_role)
     ON CONFLICT (account_id, user_id) DO UPDATE SET role = EXCLUDED.role
     RETURNING account_id, user_id, role`,
    [accountId, userId, role],
  );
  return rows[0];
}

/**
 * Remove a member, refusing to orphan the account.
 *
 * The owner count and the delete are one transaction: two admins each removing
 * the other's owner role concurrently could otherwise leave zero owners.
 */
export async function removeMember(accountId, userId) {
  return withTransaction(async (client) => {
    const target = await client.query(
      'SELECT role FROM account_members WHERE account_id = $1 AND user_id = $2 FOR UPDATE',
      [accountId, userId],
    );

    if (!target.rows[0]) return { removed: false, reason: 'not_found' };

    if (target.rows[0].role === 'owner') {
      const owners = await client.query(
        `SELECT COUNT(*)::int AS count FROM account_members
          WHERE account_id = $1 AND role = 'owner'`,
        [accountId],
      );
      if (owners.rows[0].count <= 1) return { removed: false, reason: 'last_owner' };
    }

    await client.query('DELETE FROM account_members WHERE account_id = $1 AND user_id = $2', [
      accountId,
      userId,
    ]);

    return { removed: true };
  });
}

export async function updateAccount(accountId, { businessName, googleReviewUrl, timezone }) {
  const { rows } = await query(
    `UPDATE accounts
        SET business_name     = COALESCE($2, business_name),
            google_review_url = COALESCE($3, google_review_url),
            timezone          = COALESCE($4, timezone)
      WHERE id = $1
      RETURNING id, business_name, slug, google_review_url, timezone, ip_allowlist_enabled`,
    [accountId, businessName ?? null, googleReviewUrl ?? null, timezone ?? null],
  );
  return rows[0] ?? null;
}

export async function getAccount(accountId) {
  const { rows } = await query(
    `SELECT id, business_name, slug, google_review_url, timezone, ip_allowlist_enabled
       FROM accounts WHERE id = $1`,
    [accountId],
  );
  return rows[0] ?? null;
}
