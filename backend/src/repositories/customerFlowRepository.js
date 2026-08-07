import { withTransaction } from '../db/pool.js';

/**
 * Data access for the anonymous customer flow.
 *
 * Every function here takes a client from `withPublicStand`, which has already
 * bound the tenant. Nothing accepts an account id from a caller, because the
 * caller is an anonymous customer: the stand token is the only tenant input the
 * public path has, and it is resolved server-side.
 */

/**
 * Run `callback` in one transaction, scoped to the business that owns `token`.
 *
 * Two settings are bound, in order, and both matter:
 *
 *   `app.public_stand_token` opens the narrow SELECT policy on `qr_stands` for
 *   exactly the one stand whose token was supplied. It is bound as a
 *   *parameter*, never interpolated — this is the value the whole isolation
 *   argument rests on.
 *
 *   `app.current_account_id` is then read out of that row, so ordinary tenant
 *   RLS covers every statement the callback runs. The account is never taken
 *   from the request body; submitting another business's id changes nothing.
 *
 * Both are transaction-local (`set_config(..., true)`), so a pooled connection
 * cannot carry either into the next request that checks it out.
 *
 * `callback(null, client)` is called for an unknown or inactive stand, so the
 * two remain indistinguishable to the caller.
 */
export async function withPublicStand(token, callback) {
  return withTransaction(async (client) => {
    await client.query('SELECT set_config($1, $2, true)', ['app.public_stand_token', token]);

    const { rows } = await client.query(
      `SELECT s.id            AS stand_id,
              s.account_id    AS account_id,
              s.label         AS stand_label,
              a.business_name AS business_name,
              COALESCE(NULLIF(s.destination_url, ''), a.google_review_url) AS google_review_url
         FROM qr_stands s
         JOIN accounts a ON a.id = s.account_id
        WHERE s.public_id = $1
          AND s.is_active`,
      [token],
    );

    const stand = rows[0] ?? null;
    if (!stand) return callback(null, client);

    await client.query('SELECT set_config($1, $2, true)', [
      'app.current_account_id',
      stand.account_id,
    ]);

    return callback(stand, client);
  });
}

// ------------------------------------------------------- idempotency -------

/**
 * Claim an idempotency key, or report what already happened under it.
 *
 * `INSERT ... ON CONFLICT DO NOTHING` waits on a concurrent uncommitted insert
 * of the same key rather than racing it. That is what makes two simultaneous
 * retries produce exactly one domain row: the loser blocks until the winner
 * commits, then observes the completed record and replays it.
 *
 * Outcomes: `claimed`, `replay`, `conflict`, `in_progress`.
 */
export async function claimIdempotency(
  client,
  { accountId, scope, operation, method, route, keyHash, requestHash, ttlSeconds, staleAfterSeconds },
) {
  const claimed = await client.query(
    `INSERT INTO idempotency_records
       (account_id, scope, operation, method, route, key_hash, request_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(secs => $8::int))
     ON CONFLICT (scope, operation, key_hash) DO NOTHING
     RETURNING id`,
    [accountId, scope, operation, method, route, keyHash, requestHash, ttlSeconds],
  );

  if (claimed.rowCount === 1) return { outcome: 'claimed' };

  const { rows } = await client.query(
    `SELECT id, request_hash, state, response_status, response_body_encrypted, claimed_at, expires_at
       FROM idempotency_records
      WHERE scope = $1 AND operation = $2 AND key_hash = $3
      FOR UPDATE`,
    [scope, operation, keyHash],
  );

  const existing = rows[0];

  // Retention removed it between the two statements. Treat the key as fresh.
  if (!existing) {
    return reclaim(client, {
      accountId,
      scope,
      operation,
      method,
      route,
      keyHash,
      requestHash,
      ttlSeconds,
    });
  }

  // Past retention, so there is nothing left to replay. Reusing the key after
  // that window starts a new operation rather than returning stale data.
  if (new Date(existing.expires_at).getTime() <= Date.now()) {
    await client.query('DELETE FROM idempotency_records WHERE id = $1', [existing.id]);
    return reclaim(client, {
      accountId,
      scope,
      operation,
      method,
      route,
      keyHash,
      requestHash,
      ttlSeconds,
    });
  }

  // Checked before state: a retry carrying different data is a conflict, and
  // must never be answered with somebody else's stored result.
  if (existing.request_hash !== requestHash) return { outcome: 'conflict' };

  if (existing.state === 'completed') {
    return {
      outcome: 'replay',
      status: existing.response_status,
      bodyEncrypted: existing.response_body_encrypted,
    };
  }

  // A claim nobody finished — the process handling it died. Taking it over is
  // what stops one crash wedging that key until retention expires it.
  const stale = await client.query(
    `UPDATE idempotency_records
        SET claimed_at = now(), expires_at = now() + make_interval(secs => $2::int)
      WHERE id = $1
        AND state = 'in_progress'
        AND claimed_at <= now() - make_interval(secs => $3::int)
      RETURNING id`,
    [existing.id, ttlSeconds, staleAfterSeconds],
  );

  if (stale.rowCount === 1) return { outcome: 'claimed' };

  return { outcome: 'in_progress' };
}

async function reclaim(client, record) {
  await client.query(
    `INSERT INTO idempotency_records
       (account_id, scope, operation, method, route, key_hash, request_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(secs => $8::int))`,
    [
      record.accountId,
      record.scope,
      record.operation,
      record.method,
      record.route,
      record.keyHash,
      record.requestHash,
      record.ttlSeconds,
    ],
  );
  return { outcome: 'claimed' };
}

/** Record the outcome of a claimed operation, so a retry can replay it. */
export async function completeIdempotency(
  client,
  { scope, operation, keyHash, status, bodyEncrypted },
) {
  const { rowCount } = await client.query(
    `UPDATE idempotency_records
        SET state = 'completed',
            response_status = $4,
            response_body_encrypted = $5,
            completed_at = now()
      WHERE scope = $1 AND operation = $2 AND key_hash = $3`,
    [scope, operation, keyHash, status, bodyEncrypted ?? null],
  );
  return rowCount === 1;
}

// ----------------------------------------------------------- sessions ------

export async function insertSession(
  client,
  { accountId, standId, tokenHash, locale, clientHash, ttlSeconds },
) {
  const { rows } = await client.query(
    `INSERT INTO public_review_sessions
       (account_id, stand_id, session_token_hash, locale, client_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6::int))
     RETURNING id`,
    [accountId, standId, tokenHash, locale, clientHash, ttlSeconds],
  );
  return rows[0].id;
}

/**
 * One scan per session.
 *
 * Recorded here rather than on the page load, so that a link preview, a crawler
 * or an owner refreshing the page never inflates a business's numbers.
 */
export async function recordScan(client, { accountId, standId, clientHash, userAgent, deviceType }) {
  await client.query(
    `INSERT INTO qr_scans (account_id, stand_id, ip_hash, user_agent, device_type)
     VALUES ($1, $2, $3, left($4, 400), $5)`,
    [accountId, standId, clientHash ?? 'unknown', userAgent ?? null, deviceType ?? null],
  );
  await client.query('UPDATE qr_stands SET scans_count = scans_count + 1 WHERE id = $1', [standId]);
}

/** Resolve a session by its opaque token, scoped to the stand it was issued for. */
export async function findSession(client, { standId, tokenHash }) {
  const { rows } = await client.query(
    `SELECT id, expires_at
       FROM public_review_sessions
      WHERE session_token_hash = $1 AND stand_id = $2`,
    [tokenHash, standId],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------- responses ------

export async function insertResponse(
  client,
  { accountId, standId, sessionId, tokenHash, rating, noteEncrypted },
) {
  const { rows } = await client.query(
    `INSERT INTO customer_responses
       (account_id, stand_id, session_id, response_token_hash, rating, note_encrypted)
     VALUES ($1, $2, $3, $4, $5::smallint, $6)
     RETURNING id`,
    [accountId, standId, sessionId, tokenHash, rating, noteEncrypted],
  );
  return rows[0].id;
}

export async function responseExistsForSession(client, sessionId) {
  const { rowCount } = await client.query(
    'SELECT 1 FROM customer_responses WHERE session_id = $1',
    [sessionId],
  );
  return rowCount > 0;
}

/**
 * Resolve a response by its opaque token.
 *
 * The join to the session is the check that a response token stolen from one
 * customer cannot be replayed against a different session or a different
 * business: all three must agree.
 *
 * The rating is deliberately not selected. Nothing downstream of this needs it,
 * and Team Praise must never see it.
 */
export async function findResponse(client, { standId, sessionTokenHash, responseTokenHash }) {
  const { rows } = await client.query(
    `SELECT r.id
       FROM customer_responses r
       JOIN public_review_sessions s ON s.id = r.session_id
      WHERE r.response_token_hash = $1
        AND r.stand_id = $2
        AND s.session_token_hash = $3`,
    [responseTokenHash, standId, sessionTokenHash],
  );
  return rows[0] ?? null;
}

// ------------------------------------------------------ google clicks ------

/**
 * Record that the Google opportunity was selected.
 *
 * Not that a review was written, submitted, or published — ReviewBoost cannot
 * observe any of those, and no metric built on this table may imply otherwise.
 */
export async function recordGoogleClick(client, { accountId, responseId }) {
  await client.query(
    `INSERT INTO google_review_clicks (account_id, response_id)
     VALUES ($1, $2)
     ON CONFLICT (response_id) DO NOTHING`,
    [accountId, responseId],
  );
}

// -------------------------------------------------------- team praise ------

export async function insertTeamPraise(
  client,
  { accountId, standId, responseId, firstNameEncrypted, noteEncrypted },
) {
  const { rows } = await client.query(
    `INSERT INTO team_praise_records
       (account_id, stand_id, response_id, first_name_encrypted, praise_note_encrypted)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [accountId, standId, responseId, firstNameEncrypted, noteEncrypted],
  );
  return rows[0].id;
}

export async function teamPraiseExistsForResponse(client, responseId) {
  const { rowCount } = await client.query(
    'SELECT 1 FROM team_praise_records WHERE response_id = $1',
    [responseId],
  );
  return rowCount > 0;
}

// ---------------------------------------------------------- retention ------

/**
 * Scheduled retention.
 *
 * Runs with no tenant context, which the two narrow retention policies in
 * migration 003 permit and nothing else. Sessions are not deleted: a session is
 * the scan a business paid for and `customer_responses` cascades from it, so
 * only the short-lived client hash is scrubbed.
 */
export async function purgeCustomerFlowEphemera({ clientHashRetentionDays = 7 } = {}) {
  return withTransaction(async (client) => {
    const scrubbed = await client.query(
      `UPDATE public_review_sessions
          SET client_hash = NULL
        WHERE client_hash IS NOT NULL
          AND created_at <= now() - make_interval(days => $1::int)`,
      [clientHashRetentionDays],
    );

    const purged = await client.query(
      'DELETE FROM idempotency_records WHERE expires_at <= now()',
    );

    return { clientHashesScrubbed: scrubbed.rowCount, idempotencyRecordsPurged: purged.rowCount };
  });
}
