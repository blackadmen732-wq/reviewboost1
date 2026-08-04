import { query, withTenant } from '../db/pool.js';

/**
 * Contacts, suppressions, campaigns, and messages.
 *
 * Everything here runs inside `withTenant`, so Row Level Security scopes each
 * statement to one account even if a WHERE clause is ever forgotten. The
 * exceptions at the bottom are provider callbacks, which arrive with no tenant
 * context and go through SECURITY DEFINER functions instead.
 */

// -------------------------------------------------------------- contacts ---

export async function upsertContacts(accountId, contacts) {
  if (contacts.length === 0) return [];

  return withTenant(accountId, async (client) => {
    const saved = [];

    for (const contact of contacts) {
      const { rows } = await client.query(
        `INSERT INTO contacts
           (account_id, phone_encrypted, phone_lookup, name_encrypted,
            consent, consent_source, consent_at, timezone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (account_id, phone_lookup) DO UPDATE
           SET name_encrypted = COALESCE(EXCLUDED.name_encrypted, contacts.name_encrypted),
               -- Consent is monotonic: once given it is not withdrawn by a
               -- later upload that simply omitted the flag.
               consent        = contacts.consent OR EXCLUDED.consent,
               consent_source = COALESCE(EXCLUDED.consent_source, contacts.consent_source),
               consent_at     = COALESCE(contacts.consent_at, EXCLUDED.consent_at),
               timezone       = COALESCE(EXCLUDED.timezone, contacts.timezone),
               updated_at     = now()
         RETURNING id, phone_lookup, consent, consent_at, timezone`,
        [
          accountId,
          contact.phoneEncrypted,
          contact.phoneLookup,
          contact.nameEncrypted ?? null,
          contact.consent ?? false,
          contact.consentSource ?? null,
          contact.consentAt ?? null,
          contact.timezone ?? null,
        ],
      );
      saved.push(rows[0]);
    }

    return saved;
  });
}

export async function listContacts(accountId, { limit = 50, offset = 0 } = {}) {
  return withTenant(accountId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, phone_encrypted, name_encrypted, consent, consent_at, timezone, created_at
         FROM contacts
        WHERE account_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      [accountId, Math.min(limit, 200), offset],
    );

    const total = await client.query(
      'SELECT COUNT(*)::int AS count FROM contacts WHERE account_id = $1',
      [accountId],
    );

    return { contacts: rows, total: total.rows[0].count };
  });
}

// ---------------------------------------------------------- suppressions ---

/** One bulk query rather than one per recipient. */
export async function loadSuppressedLookups(accountId, phoneLookups) {
  if (phoneLookups.length === 0) return new Set();

  return withTenant(accountId, async (client) => {
    const { rows } = await client.query(
      'SELECT phone_lookup FROM suppressions WHERE account_id = $1 AND phone_lookup = ANY($2::text[])',
      [accountId, phoneLookups],
    );
    return new Set(rows.map((row) => row.phone_lookup));
  });
}

export async function addSuppression(accountId, { phoneLookup, reason, source }) {
  await withTenant(accountId, (client) =>
    client.query(
      `INSERT INTO suppressions (account_id, phone_lookup, reason, source)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, phone_lookup) DO NOTHING`,
      [accountId, phoneLookup, reason ?? 'stop_keyword', source ?? null],
    ),
  );
}

export async function removeSuppression(accountId, phoneLookup) {
  return withTenant(accountId, async (client) => {
    const { rowCount } = await client.query(
      'DELETE FROM suppressions WHERE account_id = $1 AND phone_lookup = $2',
      [accountId, phoneLookup],
    );
    return rowCount > 0;
  });
}

export async function listSuppressions(accountId, { limit = 100, offset = 0 } = {}) {
  return withTenant(accountId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, reason, source, created_at FROM suppressions
        WHERE account_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [accountId, Math.min(limit, 500), offset],
    );
    return rows;
  });
}

// ------------------------------------------------------------- campaigns ---

export async function createCampaign(accountId, campaign) {
  return withTenant(accountId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO campaigns
         (account_id, name, message_template, review_link, status,
          total_recipients, estimated_cost_cents, scheduled_at, created_by)
       VALUES ($1, $2, $3, $4, $5::campaign_status, $6, $7, $8, $9)
       RETURNING *`,
      [
        accountId,
        campaign.name,
        campaign.messageTemplate,
        campaign.reviewLink,
        campaign.status ?? 'draft',
        campaign.totalRecipients ?? 0,
        campaign.estimatedCostCents ?? 0,
        campaign.scheduledAt ?? null,
        campaign.createdBy ?? null,
      ],
    );
    return rows[0];
  });
}

export async function updateCampaignStatus(accountId, campaignId, status, patch = {}) {
  return withTenant(accountId, async (client) => {
    const { rows } = await client.query(
      `UPDATE campaigns
          SET status       = $3::campaign_status,
              started_at   = COALESCE($4, started_at),
              completed_at = COALESCE($5, completed_at)
        WHERE account_id = $1 AND id = $2
        RETURNING *`,
      [accountId, campaignId, status, patch.startedAt ?? null, patch.completedAt ?? null],
    );
    return rows[0] ?? null;
  });
}

export async function getCampaign(accountId, campaignId) {
  return withTenant(accountId, async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM campaigns WHERE account_id = $1 AND id = $2',
      [accountId, campaignId],
    );
    return rows[0] ?? null;
  });
}

export async function listCampaigns(accountId, { limit = 25, offset = 0 } = {}) {
  return withTenant(accountId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, name, status, total_recipients, sent_count, delivered_count,
              failed_count, suppressed_count, estimated_cost_cents,
              scheduled_at, started_at, completed_at, created_at
         FROM campaigns
        WHERE account_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      [accountId, Math.min(limit, 100), offset],
    );

    const total = await client.query(
      'SELECT COUNT(*)::int AS count FROM campaigns WHERE account_id = $1',
      [accountId],
    );

    return { campaigns: rows, total: total.rows[0].count };
  });
}

// -------------------------------------------------------------- messages ---

/**
 * Insert every message for a campaign in one statement.
 *
 * This is what replaces the per-recipient read/write loop: one round trip
 * regardless of recipient count, instead of several per recipient. It is the
 * difference between a campaign of 500 taking eleven seconds and taking
 * milliseconds.
 */
export async function insertCampaignMessages(accountId, campaignId, messages) {
  if (messages.length === 0) return [];

  return withTenant(accountId, async (client) => {
    const values = [];
    const placeholders = messages.map((message, index) => {
      const base = index * 9;
      values.push(
        accountId,
        campaignId,
        message.contactId ?? null,
        message.phoneEncrypted,
        message.phoneLookup,
        message.bodyEncrypted,
        message.status ?? 'queued',
        message.segmentCount ?? 1,
        message.encoding ?? null,
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ` +
        `$${base + 6}, $${base + 7}::message_status, $${base + 8}, $${base + 9})`;
    });

    const { rows } = await client.query(
      `INSERT INTO messages
         (account_id, campaign_id, contact_id, phone_encrypted,
          phone_lookup, body_encrypted, status, segment_count, encoding)
       VALUES ${placeholders.join(', ')}
       RETURNING id, phone_lookup, status, segment_count`,
      values,
    );

    return rows;
  });
}

/** Phone lookups already messaged inside the dedupe window. One bulk query. */
export async function findRecentRecipients(accountId, phoneLookups, sinceIso) {
  if (phoneLookups.length === 0) return new Set();

  return withTenant(accountId, async (client) => {
    const { rows } = await client.query(
      `SELECT DISTINCT phone_lookup
         FROM messages
        WHERE account_id = $1
          AND phone_lookup = ANY($2::text[])
          AND created_at >= $3
          AND status NOT IN ('failed', 'suppressed', 'duplicate')`,
      [accountId, phoneLookups, sinceIso],
    );
    return new Set(rows.map((row) => row.phone_lookup));
  });
}

export async function getMessageForSend(accountId, messageId) {
  return withTenant(accountId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, account_id, campaign_id, phone_encrypted, phone_lookup,
              body_encrypted, status, provider_sid, segment_count
         FROM messages WHERE account_id = $1 AND id = $2`,
      [accountId, messageId],
    );
    return rows[0] ?? null;
  });
}

/**
 * Mark a message sent.
 *
 * Guarded on `status = 'queued'`, so a redelivered job cannot overwrite an
 * already-recorded provider SID and lose the delivery-receipt linkage.
 */
export async function markMessageSent(accountId, messageId, { providerSid, segments, costInCents }) {
  return withTenant(accountId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE messages
          SET status = 'sent', provider_sid = $3, segment_count = $4,
              cost_in_cents = $5, sent_at = now()
        WHERE account_id = $1 AND id = $2 AND status = 'queued'`,
      [accountId, messageId, providerSid, segments, costInCents],
    );
    return rowCount > 0;
  });
}

export async function markMessageStatus(accountId, messageId, status, { errorCode, errorMessage } = {}) {
  await withTenant(accountId, (client) =>
    client.query(
      `UPDATE messages
          SET status = $3::message_status,
              error_code = $4,
              error_message = $5
        WHERE account_id = $1 AND id = $2`,
      [accountId, messageId, status, errorCode ?? null, String(errorMessage ?? '').slice(0, 500) || null],
    ),
  );
}

export async function listCampaignMessages(accountId, campaignId, { limit = 100, offset = 0 } = {}) {
  return withTenant(accountId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, phone_encrypted, status, segment_count, cost_in_cents,
              error_message, sent_at, delivered_at, created_at
         FROM messages
        WHERE account_id = $1 AND campaign_id = $2
        ORDER BY created_at
        LIMIT $3 OFFSET $4`,
      [accountId, campaignId, Math.min(limit, 500), offset],
    );
    return rows;
  });
}

/** Roll message outcomes up onto the campaign row. */
export async function refreshCampaignCounters(accountId, campaignId) {
  return withTenant(accountId, async (client) => {
    const { rows } = await client.query(
      `UPDATE campaigns c
          SET sent_count       = s.sent,
              delivered_count  = s.delivered,
              failed_count     = s.failed,
              suppressed_count = s.suppressed,
              completed_at     = CASE WHEN s.pending = 0 THEN COALESCE(c.completed_at, now())
                                      ELSE c.completed_at END,
              status           = CASE WHEN s.pending = 0 AND c.status = 'running'
                                      THEN 'completed'::campaign_status ELSE c.status END
         FROM (
           SELECT COUNT(*) FILTER (WHERE status IN ('sent', 'delivered'))::int        AS sent,
                  COUNT(*) FILTER (WHERE status = 'delivered')::int                   AS delivered,
                  COUNT(*) FILTER (WHERE status = 'failed')::int                      AS failed,
                  COUNT(*) FILTER (WHERE status IN ('suppressed', 'duplicate'))::int  AS suppressed,
                  COUNT(*) FILTER (WHERE status IN ('pending', 'queued'))::int        AS pending
             FROM messages WHERE account_id = $1 AND campaign_id = $2
         ) s
        WHERE c.account_id = $1 AND c.id = $2
        RETURNING c.*`,
      [accountId, campaignId],
    );
    return rows[0] ?? null;
  });
}

// ---------------------------------------------------- provider callbacks ---
// No tenant context. The SECURITY DEFINER functions scope each write to
// exactly one row.

export async function recordDeliveryStatus(providerSid, status, errorCode, errorMessage) {
  const { rows } = await query(
    'SELECT record_delivery_status($1, $2::message_status, $3, $4) AS account_id',
    [providerSid, status, errorCode ?? null, errorMessage ?? null],
  );
  return rows[0]?.account_id ?? null;
}

export async function suppressByProviderSid(providerSid, reason) {
  const { rows } = await query('SELECT suppress_contact_by_provider($1, $2) AS account_id', [
    providerSid,
    reason,
  ]);
  return rows[0]?.account_id ?? null;
}

// ------------------------------------------------------------- analytics ---

export async function accountDashboard(accountId) {
  return withTenant(accountId, async (client) => {
    const { rows } = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM messages WHERE account_id = $1)                          AS messages_total,
         (SELECT COUNT(*)::int FROM messages WHERE account_id = $1 AND status = 'delivered') AS messages_delivered,
         (SELECT COUNT(*)::int FROM messages WHERE account_id = $1 AND status = 'failed')    AS messages_failed,
         (SELECT COALESCE(SUM(cost_in_cents), 0)::int FROM messages WHERE account_id = $1)   AS spend_in_cents,
         (SELECT COUNT(*)::int FROM contacts WHERE account_id = $1)                          AS contacts_total,
         (SELECT COUNT(*)::int FROM suppressions WHERE account_id = $1)                      AS suppressed_total,
         (SELECT COUNT(*)::int FROM qr_scans WHERE account_id = $1)                          AS scans_total,
         (SELECT COUNT(*)::int FROM private_feedback WHERE account_id = $1)                  AS feedback_intercepted,
         (SELECT COALESCE(AVG(rating), 0)::numeric(3,2) FROM private_feedback WHERE account_id = $1)
                                                                                             AS average_private_rating`,
      [accountId],
    );
    return rows[0];
  });
}
