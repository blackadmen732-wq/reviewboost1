import { withTenant } from '../db/pool.js';

/**
 * QR / NFC stand management, scan analytics, and stored customer feedback.
 *
 * Every function here is tenant-scoped through `withTenant`, because every
 * caller is an authenticated owner. The anonymous customer path lives in
 * customerFlowRepository.js, which derives the tenant from the stand token
 * instead — it never accepts an account id, because a caller who could name a
 * tenant could write unlimited fabricated feedback into it.
 */

// ------------------------------------------------- management (authed) -----

export async function createStand(accountId, stand) {
  return withTenant(accountId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO qr_stands
         (account_id, public_id, label, destination_url, primary_color, background_color)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        accountId,
        stand.publicId,
        stand.label,
        stand.destinationUrl ?? null,
        stand.primaryColor ?? '#111827',
        stand.backgroundColor ?? '#FFFFFF',
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
              is_active        = COALESCE($7, is_active)
        WHERE account_id = $1 AND id = $2
        RETURNING *`,
      [
        accountId,
        standId,
        patch.label ?? null,
        patch.destinationUrl ?? null,
        patch.primaryColor ?? null,
        patch.backgroundColor ?? null,
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
