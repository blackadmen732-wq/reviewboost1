import { query, withTenant } from '../db/pool.js';

/**
 * QR / NFC stands, scans, and intercepted feedback.
 *
 * The public scan and feedback paths are uncredentialed, so they go through
 * SECURITY DEFINER functions that derive `account_id` from the stand itself.
 * The tenant is never taken from client input — accepting an account id from an
 * anonymous caller would let anyone who scanned a code write unlimited fake
 * feedback into that business.
 */

// ------------------------------------------------- management (authed) -----

export async function createStand(accountId, stand) {
  return withTenant(accountId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO qr_stands
         (account_id, public_id, label, destination_url,
          primary_color, background_color, review_threshold)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        accountId,
        stand.publicId,
        stand.label,
        stand.destinationUrl ?? null,
        stand.primaryColor ?? '#111827',
        stand.backgroundColor ?? '#FFFFFF',
        stand.reviewThreshold ?? 4,
      ],
    );
    return rows[0];
  });
}

export async function listStands(accountId) {
  return withTenant(accountId, async (client) => {
    const { rows } = await client.query(
      `SELECT s.*,
              (SELECT COUNT(*)::int FROM qr_scans
                WHERE stand_id = s.id AND scanned_at >= CURRENT_DATE - 30) AS scans_last_30_days
         FROM qr_stands s
        WHERE s.account_id = $1
        ORDER BY s.created_at DESC`,
      [accountId],
    );
    return rows;
  });
}

export async function getStand(accountId, standId) {
  return withTenant(accountId, async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM qr_stands WHERE account_id = $1 AND id = $2',
      [accountId, standId],
    );
    return rows[0] ?? null;
  });
}

export async function updateStand(accountId, standId, patch) {
  return withTenant(accountId, async (client) => {
    const { rows } = await client.query(
      `UPDATE qr_stands
          SET label            = COALESCE($3, label),
              destination_url  = COALESCE($4, destination_url),
              primary_color    = COALESCE($5, primary_color),
              background_color = COALESCE($6, background_color),
              review_threshold = COALESCE($7, review_threshold),
              is_active        = COALESCE($8, is_active)
        WHERE account_id = $1 AND id = $2
        RETURNING *`,
      [
        accountId,
        standId,
        patch.label ?? null,
        patch.destinationUrl ?? null,
        patch.primaryColor ?? null,
        patch.backgroundColor ?? null,
        patch.reviewThreshold ?? null,
        patch.isActive ?? null,
      ],
    );
    return rows[0] ?? null;
  });
}

export async function deleteStand(accountId, standId) {
  return withTenant(accountId, async (client) => {
    const { rowCount } = await client.query(
      'DELETE FROM qr_stands WHERE account_id = $1 AND id = $2',
      [accountId, standId],
    );
    return rowCount > 0;
  });
}

// -------------------------------------------------------- public path ------

/**
 * Resolve a stand for `/q/:publicId`.
 *
 * Runs outside tenant context by necessity — the scanner has no session. Only
 * the fields the gate page needs are selected, and `account_id` is deliberately
 * not among them so it cannot leak to an anonymous client.
 */
export async function resolveStandByPublicId(publicId) {
  const { rows } = await query(
    `SELECT s.id AS stand_id,
            s.label,
            s.review_threshold,
            s.is_active,
            s.destination_url,
            a.business_name,
            a.google_review_url,
            b.status AS subscription_status,
            b.trial_ends_at
       FROM qr_stands s
       JOIN accounts a ON a.id = s.account_id
       LEFT JOIN billing_subscriptions b ON b.account_id = s.account_id
      WHERE s.public_id = $1`,
    [publicId],
  );
  return rows[0] ?? null;
}

/** Append a scan, deduplicated by hashed address inside a short window. */
export async function registerScan({ standId, ipHash, userAgent, deviceType }) {
  const { rows } = await query('SELECT register_scan($1, $2, $3, $4) AS recorded', [
    standId,
    ipHash,
    userAgent?.slice(0, 400) ?? null,
    deviceType ?? null,
  ]);
  return rows[0]?.recorded === true;
}

/** Store intercepted feedback. The tenant is derived from the stand. */
export async function submitPrivateFeedback({
  standId,
  rating,
  feedbackEncrypted,
  phoneEncrypted = null,
  emailEncrypted = null,
}) {
  const { rows } = await query(
    'SELECT submit_private_feedback($1, $2::smallint, $3, $4, $5) AS feedback_id',
    [standId, rating, feedbackEncrypted, phoneEncrypted, emailEncrypted],
  );
  return rows[0]?.feedback_id ?? null;
}

// --------------------------------------------------------- analytics -------

export async function listFeedback(accountId, { limit = 50, offset = 0 } = {}) {
  return withTenant(accountId, async (client) => {
    const { rows } = await client.query(
      `SELECT f.id, f.rating, f.feedback_encrypted, f.phone_encrypted,
              f.resolved_at, f.created_at, s.label AS stand_label
         FROM private_feedback f
         LEFT JOIN qr_stands s ON s.id = f.stand_id
        WHERE f.account_id = $1
        ORDER BY f.created_at DESC
        LIMIT $2 OFFSET $3`,
      [accountId, Math.min(limit, 200), offset],
    );

    const total = await client.query(
      'SELECT COUNT(*)::int AS count FROM private_feedback WHERE account_id = $1',
      [accountId],
    );

    return { feedback: rows, total: total.rows[0].count };
  });
}

export async function resolveFeedback(accountId, feedbackId) {
  return withTenant(accountId, async (client) => {
    const { rows } = await client.query(
      `UPDATE private_feedback SET resolved_at = now()
        WHERE account_id = $1 AND id = $2 RETURNING id, resolved_at`,
      [accountId, feedbackId],
    );
    return rows[0] ?? null;
  });
}

export async function scanAnalytics(accountId, days = 30) {
  return withTenant(accountId, async (client) => {
    const daily = await client.query(
      `SELECT date_trunc('day', scanned_at)::date  AS day,
              COUNT(*)::int                         AS scans,
              COUNT(*) FILTER (WHERE converted)::int AS conversions,
              COUNT(DISTINCT ip_hash)::int          AS unique_visitors
         FROM qr_scans
        WHERE account_id = $1 AND scanned_at >= CURRENT_DATE - $2::int
        GROUP BY 1 ORDER BY 1`,
      [accountId, days],
    );

    const byDevice = await client.query(
      `SELECT COALESCE(device_type, 'unknown') AS device_type, COUNT(*)::int AS scans
         FROM qr_scans
        WHERE account_id = $1 AND scanned_at >= CURRENT_DATE - $2::int
        GROUP BY 1 ORDER BY 2 DESC`,
      [accountId, days],
    );

    return { daily: daily.rows, byDevice: byDevice.rows };
  });
}
