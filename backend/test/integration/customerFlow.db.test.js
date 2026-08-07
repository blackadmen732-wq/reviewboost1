import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { setTestEnv } from '../helpers/testApp.js';

/**
 * The customer flow against a real Postgres.
 *
 * Skipped unless TEST_DATABASE_URL is set, so the rest of the suite still runs
 * with no infrastructure. CI provides one via a service container.
 *
 *   TEST_DATABASE_URL=postgres://... npm run test:integration
 *
 * Everything here is a property only a real database can prove: that idempotent
 * replay actually collapses duplicates, that a customer's note is unreadable in
 * the row it is stored in, that one business cannot reach another's responses,
 * and that a session issued at one stand is worthless at another. A mock would
 * assert the code called what the author expected — not that Postgres agreed.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = DATABASE_URL ? false : 'TEST_DATABASE_URL is not set';

const GOOGLE_A = 'https://g.page/r/CtenantAreview/review';
const GOOGLE_B = 'https://maps.app.goo.gl/tenantB';

let pool;
let query;
let withTenant;
let flow;
let repo;
let pii;

const tenantA = { slug: 'cf-tenant-a', token: 'cfstandaaaa01' };
const tenantB = { slug: 'cf-tenant-b', token: 'cfstandbbbb01' };
const inactive = { token: 'cfstandinact01' };
const noGoogle = { token: 'cfstandnogoog1' };

let counter = 0;
function key(operation) {
  counter += 1;
  return `rb_${operation}_test-key-${String(counter).padStart(10, '0')}`;
}

const call = { route: '/api/v1/public/q/:token/x', method: 'POST' };

async function createStand(accountId, { publicId, isActive = true, destinationUrl = null }) {
  return withTenant(accountId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO qr_stands (account_id, public_id, label, destination_url, is_active)
       VALUES ($1, $2, 'Front Desk', $3, $4)
       RETURNING id`,
      [accountId, publicId, destinationUrl, isActive],
    );
    return rows[0].id;
  });
}

/** Session, then response. The two steps every later assertion starts from. */
async function startFlow(token, { rating = 5, note, locale = 'en' } = {}) {
  const session = await flow.createSession(token, {
    locale,
    idempotencyKey: key('session'),
    ip: '203.0.113.10',
    userAgent: 'Mozilla/5.0 (iPhone)',
    ...call,
  });

  const response = await flow.submitResponse(token, {
    sessionId: session.body.sessionId,
    rating,
    note,
    idempotencyKey: key('response'),
    ...call,
  });

  return { sessionId: session.body.sessionId, responseId: response.body.responseId };
}

before(async () => {
  if (skip) return;

  setTestEnv({ DATABASE_URL });
  ({ pool, query, withTenant } = await import('../../src/db/pool.js'));

  const { runMigrations } = await import('../../src/db/migrate.js');
  await runMigrations();

  flow = await import('../../src/services/customerFlowService.js');
  repo = await import('../../src/repositories/customerFlowRepository.js');
  ({ pii } = await import('../../src/services/encryption.js'));

  for (const [tenant, url] of [
    [tenantA, GOOGLE_A],
    [tenantB, GOOGLE_B],
  ]) {
    const { rows } = await query(
      `INSERT INTO accounts (business_name, slug, google_review_url)
       VALUES ($1, $2, $3) RETURNING id`,
      [`Business ${tenant.slug}`, tenant.slug, url],
    );
    tenant.accountId = rows[0].id;
    tenant.standId = await createStand(tenant.accountId, { publicId: tenant.token });
  }

  inactive.standId = await createStand(tenantA.accountId, {
    publicId: inactive.token,
    isActive: false,
  });

  // Active, but its destination is not a Google review page. It must behave
  // exactly like an unknown token rather than serving a URL the client rejects.
  const { rows } = await query(
    `INSERT INTO accounts (business_name, slug, google_review_url)
     VALUES ('No Google', 'cf-tenant-nogoogle', 'https://example.com/not-google')
     RETURNING id`,
  );
  noGoogle.accountId = rows[0].id;
  noGoogle.standId = await createStand(noGoogle.accountId, { publicId: noGoogle.token });
});

after(async () => {
  if (skip) return;
  await query('DELETE FROM accounts WHERE slug IN ($1, $2, $3)', [
    tenantA.slug,
    tenantB.slug,
    'cf-tenant-nogoogle',
  ]);
  await pool.end();
});

// Always runs, so a silently skipped suite is visible rather than looking green.
it('reports whether the customer-flow database suite is enabled', () => {
  if (skip) {
    console.log('  [customer flow DB suite SKIPPED] set TEST_DATABASE_URL to run it');
  }
  assert.ok(true);
});

describe('schema', { skip }, () => {
  it('forces row security on every new tenant table', async () => {
    // ENABLE alone is not enough: Postgres exempts the table owner, and the
    // owner is the role the application connects as. Without FORCE every policy
    // is inert and the schema isolates nothing.
    const { rows } = await query(
      `SELECT relname, relrowsecurity, relforcerowsecurity
         FROM pg_class
        WHERE relname = ANY($1)`,
      [
        [
          'public_review_sessions',
          'customer_responses',
          'google_review_clicks',
          'team_praise_records',
          'idempotency_records',
        ],
      ],
    );

    assert.equal(rows.length, 5);
    for (const row of rows) {
      assert.equal(row.relrowsecurity, true, `${row.relname} has RLS disabled`);
      assert.equal(row.relforcerowsecurity, true, `${row.relname} does not FORCE RLS`);
    }
  });

  it('has no rating threshold anywhere in the customer flow', async () => {
    const { rows } = await query(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (column_name ILIKE '%threshold%' OR column_name ILIKE '%intercept%')
          AND table_name IN ('public_review_sessions', 'customer_responses',
                             'google_review_clicks', 'team_praise_records')`,
    );
    assert.deepEqual(rows, []);
  });

  it('keeps the rating out of the Team Praise table entirely', async () => {
    // The privacy barrier starts in the schema: a column that does not exist
    // cannot be selected into a DTO by accident.
    const { rows } = await query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'team_praise_records'`,
    );
    const columns = rows.map((row) => row.column_name);

    for (const forbidden of ['rating', 'stars', 'google_clicked_at', 'phone', 'email']) {
      assert.ok(!columns.includes(forbidden), `team_praise_records exposes ${forbidden}`);
    }
  });
});

describe('public context', { skip }, () => {
  it('returns the contract shape and nothing else', async () => {
    const context = await flow.getContext(tenantA.token);

    assert.deepEqual(Object.keys(context).sort(), [
      'business',
      'defaultLocale',
      'googleReviewUrl',
      'location',
      'supportedLocales',
    ]);
    assert.equal(context.googleReviewUrl, GOOGLE_A);
    assert.equal(context.business.name, `Business ${tenantA.slug}`);
  });

  it('never returns a tenant or stand identifier', async () => {
    const body = JSON.stringify(await flow.getContext(tenantA.token));
    assert.doesNotMatch(body, new RegExp(tenantA.accountId, 'i'));
    assert.doesNotMatch(body, new RegExp(tenantA.standId, 'i'));
  });

  it('records no scan, so a page load cannot inflate the numbers', async () => {
    const before = await scanCount(tenantA.accountId, tenantA.standId);
    await flow.getContext(tenantA.token);
    assert.equal(await scanCount(tenantA.accountId, tenantA.standId), before);
  });

  it('makes unknown, inactive, and unconfigured stands indistinguishable', async () => {
    const outcomes = await Promise.all(
      ['cfdoesnotexist1', inactive.token, noGoogle.token].map((token) =>
        flow.getContext(token).then(
          () => ({ ok: true }),
          (error) => ({ status: error.status, code: error.code, message: error.message }),
        ),
      ),
    );

    for (const outcome of outcomes) {
      assert.deepEqual(outcome, {
        status: 404,
        code: 'review_link_inactive',
        message: 'This review link is not active.',
      });
    }
  });
});

describe('every rating is treated the same', { skip }, () => {
  it('stores all five and answers each identically', async () => {
    const results = [];

    for (const rating of [1, 2, 3, 4, 5]) {
      const session = await flow.createSession(tenantA.token, {
        locale: 'en',
        idempotencyKey: key('session'),
        ip: '203.0.113.11',
        userAgent: 'Mozilla/5.0 (iPhone)',
        ...call,
      });

      const response = await flow.submitResponse(tenantA.token, {
        sessionId: session.body.sessionId,
        rating,
        idempotencyKey: key('response'),
        ...call,
      });

      results.push({
        rating,
        status: response.status,
        keys: Object.keys(response.body).sort().join(','),
      });
    }

    for (const result of results) {
      assert.equal(result.status, 201, `rating ${result.rating} answered differently`);
      assert.equal(result.keys, 'responseId');
    }

    const { rows } = await asTenant(
      tenantA.accountId,
      `SELECT rating, COUNT(*)::int AS stored
         FROM customer_responses WHERE account_id = $1 GROUP BY rating ORDER BY rating`,
      [tenantA.accountId],
    );
    const stored = Object.fromEntries(rows.map((row) => [row.rating, row.stored]));

    // Including 4 and 5. A high rating is not a "conversion" that skips storage.
    for (const rating of [1, 2, 3, 4, 5]) {
      assert.ok((stored[rating] ?? 0) >= 1, `rating ${rating} was not stored`);
    }
  });

  it('offers the same Google destination whatever the customer chose', async () => {
    // The context is fetched before a rating exists and never re-fetched with
    // one, which is structurally why the opportunity cannot vary by rating.
    const contexts = [];
    for (const rating of [1, 2, 3, 4, 5]) {
      await startFlow(tenantA.token, { rating });
      contexts.push(await flow.getContext(tenantA.token));
    }

    for (const context of contexts) assert.deepEqual(context, contexts[0]);
  });

  it('accepts a note on every rating and requires one on none', async () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      const withNote = await startFlow(tenantA.token, { rating, note: `note for ${rating}` });
      assert.ok(withNote.responseId);

      const without = await startFlow(tenantA.token, { rating });
      assert.ok(without.responseId);
    }
  });
});

describe('private notes at rest', { skip }, () => {
  it('stores the note encrypted and recovers it only through the key', async () => {
    const secret = 'The table was sticky and nobody came over for ten minutes.';
    const { responseId } = await startFlow(tenantA.token, { rating: 2, note: secret });

    const { rows } = await asTenant(
      tenantA.accountId,
      `SELECT note_encrypted FROM customer_responses
        WHERE response_token_hash = $1`,
      [responseTokenHash(responseId)],
    );

    assert.ok(rows[0].note_encrypted);
    assert.doesNotMatch(rows[0].note_encrypted, /sticky/);
    assert.equal(pii.decrypt(rows[0].note_encrypted), secret);
    assert.ok(responseId);
  });

  it('stores no ciphertext at all when there is no note', async () => {
    const { responseId } = await startFlow(tenantA.token, { rating: 5 });

    const { rows } = await asTenant(
      tenantA.accountId,
      'SELECT note_encrypted FROM customer_responses WHERE response_token_hash = $1',
      [responseTokenHash(responseId)],
    );
    assert.equal(rows[0].note_encrypted, null);
  });

  it('never stores the session token itself', async () => {
    const session = await flow.createSession(tenantA.token, {
      locale: 'en',
      idempotencyKey: key('session'),
      ip: '203.0.113.12',
      userAgent: 'Mozilla/5.0 (iPhone)',
      ...call,
    });

    const { rows } = await asTenant(
      tenantA.accountId,
      'SELECT session_token_hash FROM public_review_sessions WHERE account_id = $1',
      [tenantA.accountId],
    );

    for (const row of rows) {
      assert.notEqual(row.session_token_hash, session.body.sessionId);
    }
  });
});

describe('idempotency', { skip }, () => {
  it('collapses a retried session into one row and replays the result', async () => {
    const idempotencyKey = key('session');
    const before = await countRows('public_review_sessions', tenantA.accountId);

    const first = await flow.createSession(tenantA.token, {
      locale: 'en',
      idempotencyKey,
      ip: '203.0.113.13',
      userAgent: 'Mozilla/5.0 (iPhone)',
      ...call,
    });
    const retry = await flow.createSession(tenantA.token, {
      locale: 'en',
      idempotencyKey,
      ip: '203.0.113.13',
      userAgent: 'Mozilla/5.0 (iPhone)',
      ...call,
    });

    assert.equal(first.status, 201);
    // A replay created nothing, so it is a 200 rather than a second 201.
    assert.equal(retry.status, 200);
    assert.equal(retry.body.sessionId, first.body.sessionId);
    assert.equal(await countRows('public_review_sessions', tenantA.accountId), before + 1);
  });

  it('collapses a retried response the same way', async () => {
    const session = await flow.createSession(tenantA.token, {
      locale: 'en',
      idempotencyKey: key('session'),
      ip: '203.0.113.14',
      userAgent: 'Mozilla/5.0 (iPhone)',
      ...call,
    });

    const idempotencyKey = key('response');
    const before = await countRows('customer_responses', tenantA.accountId);

    const first = await flow.submitResponse(tenantA.token, {
      sessionId: session.body.sessionId,
      rating: 4,
      idempotencyKey,
      ...call,
    });
    const retry = await flow.submitResponse(tenantA.token, {
      sessionId: session.body.sessionId,
      rating: 4,
      idempotencyKey,
      ...call,
    });

    assert.equal(first.status, 201);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.responseId, first.body.responseId);
    assert.equal(await countRows('customer_responses', tenantA.accountId), before + 1);
  });

  it('produces one row when two identical requests race', async () => {
    // The case the whole mechanism exists for: a phone on a bad connection
    // fires the retry before the first response arrives.
    const idempotencyKey = key('session');
    const before = await countRows('public_review_sessions', tenantA.accountId);

    const attempt = () =>
      flow.createSession(tenantA.token, {
        locale: 'en',
        idempotencyKey,
        ip: '203.0.113.15',
        userAgent: 'Mozilla/5.0 (iPhone)',
        ...call,
      });

    const [first, second] = await Promise.all([attempt(), attempt()]);

    assert.equal(first.body.sessionId, second.body.sessionId);
    assert.equal(await countRows('public_review_sessions', tenantA.accountId), before + 1);
    // Exactly one of them created it.
    assert.deepEqual([first.status, second.status].sort(), [200, 201]);
  });

  it('rejects the same key carrying different data', async () => {
    const session = await flow.createSession(tenantA.token, {
      locale: 'en',
      idempotencyKey: key('session'),
      ip: '203.0.113.16',
      userAgent: 'Mozilla/5.0 (iPhone)',
      ...call,
    });

    const idempotencyKey = key('response');
    await flow.submitResponse(tenantA.token, {
      sessionId: session.body.sessionId,
      rating: 3,
      idempotencyKey,
      ...call,
    });

    // Answering this with the stored 3-star result would silently discard what
    // the customer actually submitted.
    await assert.rejects(
      flow.submitResponse(tenantA.token, {
        sessionId: session.body.sessionId,
        rating: 5,
        idempotencyKey,
        ...call,
      }),
      (error) => error.status === 409 && error.code === 'idempotency_conflict',
    );
  });

  it('treats a reordered body as the same request, not a conflict', async () => {
    const session = await flow.createSession(tenantA.token, {
      locale: 'en',
      idempotencyKey: key('session'),
      ip: '203.0.113.17',
      userAgent: 'Mozilla/5.0 (iPhone)',
      ...call,
    });

    const idempotencyKey = key('response');
    const first = await flow.submitResponse(tenantA.token, {
      sessionId: session.body.sessionId,
      rating: 4,
      note: 'lovely',
      idempotencyKey,
      ...call,
    });

    const retry = await flow.submitResponse(tenantA.token, {
      note: 'lovely',
      rating: 4,
      sessionId: session.body.sessionId,
      idempotencyKey,
      ...call,
    });

    assert.equal(retry.status, 200);
    assert.equal(retry.body.responseId, first.body.responseId);
  });

  it('scopes keys per stand, so two businesses cannot collide', async () => {
    const shared = 'rb_session_shared-key-across-two-businesses';

    const a = await flow.createSession(tenantA.token, {
      locale: 'en',
      idempotencyKey: shared,
      ip: '203.0.113.18',
      userAgent: 'Mozilla/5.0 (iPhone)',
      ...call,
    });
    const b = await flow.createSession(tenantB.token, {
      locale: 'en',
      idempotencyKey: shared,
      ip: '203.0.113.18',
      userAgent: 'Mozilla/5.0 (iPhone)',
      ...call,
    });

    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.notEqual(a.body.sessionId, b.body.sessionId);
  });

  it('stores no readable token in the replay record', async () => {
    const idempotencyKey = key('session');
    const session = await flow.createSession(tenantA.token, {
      locale: 'en',
      idempotencyKey,
      ip: '203.0.113.19',
      userAgent: 'Mozilla/5.0 (iPhone)',
      ...call,
    });

    const { rows } = await asTenant(
      tenantA.accountId,
      `SELECT response_body_encrypted FROM idempotency_records
        WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [tenantA.accountId],
    );

    assert.ok(rows[0].response_body_encrypted);
    assert.doesNotMatch(rows[0].response_body_encrypted, new RegExp(session.body.sessionId));
  });

  it('takes over a claim left behind by a process that died', async () => {
    // Simulates the only way an unfinished claim can outlive its request: the
    // handler and the claim commit together, so an ordinary failure rolls both
    // back. A killed process leaves the row without the work.
    const idempotencyKey = key('session');

    await repo.withPublicStand(tenantA.token, async (stand, client) =>
      client.query(
        `INSERT INTO idempotency_records
           (account_id, scope, operation, method, route, key_hash, request_hash,
            state, claimed_at, expires_at)
         VALUES ($1, $2, 'session', 'POST', '/x', $3, $4, 'in_progress',
                 now() - INTERVAL '10 minutes', now() + INTERVAL '1 hour')`,
        [
          stand.account_id,
          `stand:${tenantA.token}`,
          abandonedKeyHash(idempotencyKey),
          abandonedRequestHash(),
        ],
      ),
    );

    const recovered = await flow.createSession(tenantA.token, {
      locale: 'en',
      idempotencyKey,
      ip: '203.0.113.20',
      userAgent: 'Mozilla/5.0 (iPhone)',
      ...call,
    });

    assert.equal(recovered.status, 201);
    assert.ok(recovered.body.sessionId);
  });
});

describe('capability tokens cannot be moved between businesses', { skip }, () => {
  it('refuses a session issued at another stand', async () => {
    const session = await flow.createSession(tenantA.token, {
      locale: 'en',
      idempotencyKey: key('session'),
      ip: '203.0.113.21',
      userAgent: 'Mozilla/5.0 (iPhone)',
      ...call,
    });

    await assert.rejects(
      flow.submitResponse(tenantB.token, {
        sessionId: session.body.sessionId,
        rating: 5,
        idempotencyKey: key('response'),
        ...call,
      }),
      (error) => error.status === 404 && error.code === 'session_not_found',
    );

    assert.equal(await countRows('customer_responses', tenantB.accountId), 0);
  });

  it('refuses a response paired with somebody else\'s session', async () => {
    const first = await startFlow(tenantA.token, { rating: 5 });
    const second = await startFlow(tenantA.token, { rating: 5 });

    await assert.rejects(
      flow.recordGoogleClick(tenantA.token, {
        sessionId: second.sessionId,
        responseId: first.responseId,
        idempotencyKey: key('google-click'),
        ...call,
      }),
      (error) => error.status === 404 && error.code === 'response_not_found',
    );
  });

  it('refuses a second response on a session that already has one', async () => {
    const session = await flow.createSession(tenantA.token, {
      locale: 'en',
      idempotencyKey: key('session'),
      ip: '203.0.113.22',
      userAgent: 'Mozilla/5.0 (iPhone)',
      ...call,
    });

    await flow.submitResponse(tenantA.token, {
      sessionId: session.body.sessionId,
      rating: 1,
      idempotencyKey: key('response'),
      ...call,
    });

    await assert.rejects(
      flow.submitResponse(tenantA.token, {
        sessionId: session.body.sessionId,
        rating: 5,
        idempotencyKey: key('response'),
        ...call,
      }),
      (error) => error.status === 409 && error.code === 'response_already_submitted',
    );
  });
});

describe('google opportunity tracking', { skip }, () => {
  it('records the selection once, however many times it is sent', async () => {
    const { sessionId, responseId } = await startFlow(tenantA.token, { rating: 3 });

    const first = await flow.recordGoogleClick(tenantA.token, {
      sessionId,
      responseId,
      idempotencyKey: key('google-click'),
      ...call,
    });
    const again = await flow.recordGoogleClick(tenantA.token, {
      sessionId,
      responseId,
      // A different key on purpose: dedupe must not depend on the client
      // reusing one, because a reopened tab generates a fresh key.
      idempotencyKey: key('google-click'),
      ...call,
    });

    assert.equal(first.status, 204);
    assert.equal(again.status, 204);

    const { rows } = await asTenant(
      tenantA.accountId,
      `SELECT COUNT(*)::int AS clicks
         FROM google_review_clicks c
         JOIN customer_responses r ON r.id = c.response_id
        WHERE r.response_token_hash = $1`,
      [responseTokenHash(responseId)],
    );

    assert.equal(rows[0].clicks, 1);
  });

  it('records a click for a one-star customer exactly as for a five-star one', async () => {
    for (const rating of [1, 5]) {
      const { sessionId, responseId } = await startFlow(tenantA.token, { rating });
      const result = await flow.recordGoogleClick(tenantA.token, {
        sessionId,
        responseId,
        idempotencyKey: key('google-click'),
        ...call,
      });
      assert.equal(result.status, 204, `rating ${rating} was tracked differently`);
    }
  });
});

describe('team praise', { skip }, () => {
  it('stores praise unmatched, encrypted, and without a rating', async () => {
    const { sessionId, responseId } = await startFlow(tenantA.token, { rating: 2 });

    const praise = await flow.submitTeamPraise(tenantA.token, {
      sessionId,
      responseId,
      firstName: 'José',
      note: 'Stayed late to sort out our order.',
      idempotencyKey: key('team-praise'),
      ...call,
    });

    assert.equal(praise.status, 201);
    assert.deepEqual(Object.keys(praise.body), ['teamPraiseId']);

    const { rows } = await asTenant(
      tenantA.accountId,
      `SELECT status, first_name_encrypted, praise_note_encrypted
         FROM team_praise_records WHERE id = $1`,
      [praise.body.teamPraiseId],
    );

    assert.equal(rows[0].status, 'unmatched');
    assert.doesNotMatch(rows[0].first_name_encrypted, /José/);
    // Stored as written: no transliteration, no accent stripping.
    assert.equal(pii.decrypt(rows[0].first_name_encrypted), 'José');
    assert.match(pii.decrypt(rows[0].praise_note_encrypted), /Stayed late/);
  });

  it('accepts praise after a low rating just as after a high one', async () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      const { sessionId, responseId } = await startFlow(tenantA.token, { rating });
      const praise = await flow.submitTeamPraise(tenantA.token, {
        sessionId,
        responseId,
        firstName: 'Sam',
        idempotencyKey: key('team-praise'),
        ...call,
      });
      assert.equal(praise.status, 201, `praise refused after a ${rating}-star rating`);
    }
  });

  it('returns nothing about the rating, the note, or the Google state', async () => {
    const { sessionId, responseId } = await startFlow(tenantA.token, {
      rating: 1,
      note: 'private complaint',
    });

    const praise = await flow.submitTeamPraise(tenantA.token, {
      sessionId,
      responseId,
      firstName: 'Sam',
      idempotencyKey: key('team-praise'),
      ...call,
    });

    const body = JSON.stringify(praise.body);
    for (const forbidden of ['rating', 'star', 'google', 'phone', 'email', 'bonus', 'payroll']) {
      assert.doesNotMatch(body, new RegExp(forbidden, 'i'));
    }
    assert.doesNotMatch(body, /private complaint/);
  });

  it('allows one praise record per response', async () => {
    const { sessionId, responseId } = await startFlow(tenantA.token, { rating: 4 });

    await flow.submitTeamPraise(tenantA.token, {
      sessionId,
      responseId,
      firstName: 'Sam',
      idempotencyKey: key('team-praise'),
      ...call,
    });

    await assert.rejects(
      flow.submitTeamPraise(tenantA.token, {
        sessionId,
        responseId,
        firstName: 'Alex',
        idempotencyKey: key('team-praise'),
        ...call,
      }),
      (error) => error.status === 409 && error.code === 'team_praise_already_submitted',
    );
  });

  it('replays a retried submission instead of storing it twice', async () => {
    const { sessionId, responseId } = await startFlow(tenantA.token, { rating: 4 });
    const idempotencyKey = key('team-praise');

    const first = await flow.submitTeamPraise(tenantA.token, {
      sessionId,
      responseId,
      firstName: 'Sam',
      idempotencyKey,
      ...call,
    });
    const retry = await flow.submitTeamPraise(tenantA.token, {
      sessionId,
      responseId,
      firstName: 'Sam',
      idempotencyKey,
      ...call,
    });

    assert.equal(first.status, 201);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.teamPraiseId, first.body.teamPraiseId);
  });
});

describe('tenant isolation', { skip }, () => {
  before(async function seedBothTenants() {
    if (skip) return;
    await startFlow(tenantA.token, { rating: 3, note: 'tenant A note' });
    await startFlow(tenantB.token, { rating: 3, note: 'tenant B note' });
  });

  const tables = [
    'public_review_sessions',
    'customer_responses',
    'google_review_clicks',
    'team_praise_records',
    'idempotency_records',
  ];

  it('hides every one of another business\'s rows', async () => {
    for (const table of tables) {
      const visible = await withTenant(tenantA.accountId, (client) =>
        client.query(`SELECT COUNT(*)::int AS c FROM ${table} WHERE account_id = $1`, [
          tenantB.accountId,
        ]),
      );
      assert.equal(visible.rows[0].c, 0, `${table} leaked tenant B rows to tenant A`);
    }
  });

  it('refuses an insert addressed to another business', async () => {
    // The attacker is allowed to submit the other tenant's UUID. The database
    // must still refuse it.
    await assert.rejects(
      withTenant(tenantA.accountId, (client) =>
        client.query(
          `INSERT INTO public_review_sessions
             (account_id, stand_id, session_token_hash, locale, expires_at)
           VALUES ($1, $2, 'forged-hash', 'en', now() + INTERVAL '1 day')`,
          [tenantB.accountId, tenantB.standId],
        ),
      ),
      /row-level security|violates/i,
    );
  });

  it('refuses an update to another business\'s response', async () => {
    const updated = await withTenant(tenantA.accountId, (client) =>
      client.query('UPDATE customer_responses SET rating = 1 WHERE account_id = $1', [
        tenantB.accountId,
      ]),
    );
    assert.equal(updated.rowCount, 0);
  });

  it('refuses a delete of another business\'s response', async () => {
    const deleted = await withTenant(tenantA.accountId, (client) =>
      client.query('DELETE FROM customer_responses WHERE account_id = $1', [tenantB.accountId]),
    );
    assert.equal(deleted.rowCount, 0);

    const survivors = await withTenant(tenantB.accountId, (client) =>
      client.query('SELECT COUNT(*)::int AS c FROM customer_responses WHERE account_id = $1', [
        tenantB.accountId,
      ]),
    );
    assert.ok(survivors.rows[0].c > 0);
  });

  it('shows nothing at all with no tenant context', async () => {
    for (const table of tables) {
      const { rows } = await query(`SELECT COUNT(*)::int AS c FROM ${table}`);
      assert.equal(rows[0].c, 0, `${table} is readable with no tenant bound`);
    }
  });

  it('exposes one stand to a token holder, and never the rest of the table', async () => {
    const { withTransaction } = await import('../../src/db/pool.js');

    const visible = await withTransaction(async (client) => {
      // Bind only the public token — no tenant context, which is exactly the
      // state an anonymous customer request is in.
      await client.query('SELECT set_config($1, $2, true)', [
        'app.public_stand_token',
        tenantA.token,
      ]);
      const { rows } = await client.query('SELECT id, public_id FROM qr_stands');
      return rows;
    });

    // Tenant A owns two stands and tenant B owns another. Binding one token
    // reveals that one row and nothing else, so the bootstrap policy is not an
    // enumeration hole.
    assert.equal(visible.length, 1);
    assert.equal(visible[0].public_id, tenantA.token);
    assert.equal(visible[0].id, tenantA.standId);

    const unbound = await query('SELECT COUNT(*)::int AS c FROM qr_stands');
    assert.equal(unbound.rows[0].c, 0);
  });

  it('will not let a foreign key cross businesses', async () => {
    // Composite keys carry account_id through every relationship, so the
    // database refuses this even if application code asks for it.
    await assert.rejects(
      withTenant(tenantA.accountId, (client) =>
        client.query(
          `INSERT INTO public_review_sessions
             (account_id, stand_id, session_token_hash, locale, expires_at)
           VALUES ($1, $2, 'cross-tenant-hash', 'en', now() + INTERVAL '1 day')`,
          [tenantA.accountId, tenantB.standId],
        ),
      ),
      /foreign key|violates/i,
    );
  });
});

describe('retention', { skip }, () => {
  it('expires idempotency records and scrubs old client hashes', async () => {
    await startFlow(tenantA.token, { rating: 5 });

    await asTenant(
      tenantA.accountId,
      `UPDATE idempotency_records SET expires_at = now() - INTERVAL '1 hour'
        WHERE account_id = $1`,
      [tenantA.accountId],
    );
    await asTenant(
      tenantA.accountId,
      `UPDATE public_review_sessions SET created_at = now() - INTERVAL '30 days'
        WHERE account_id = $1`,
      [tenantA.accountId],
    );

    const result = await repo.purgeCustomerFlowEphemera();

    assert.ok(result.idempotencyRecordsPurged > 0);
    assert.ok(result.clientHashesScrubbed > 0);

    const remaining = await asTenant(
      tenantA.accountId,
      `SELECT COUNT(*)::int AS c FROM public_review_sessions
        WHERE account_id = $1 AND client_hash IS NOT NULL`,
      [tenantA.accountId],
    );
    assert.equal(remaining.rows[0].c, 0);
  });

  it('keeps the responses, which are the business\'s own history', async () => {
    const responses = await asTenant(
      tenantA.accountId,
      'SELECT COUNT(*)::int AS c FROM customer_responses WHERE account_id = $1',
      [tenantA.accountId],
    );
    assert.ok(responses.rows[0].c > 0);
  });
});

// ------------------------------------------------------------- helpers -----

/**
 * Raw SQL inside a tenant context.
 *
 * Every table this suite inspects is under FORCE row security, so a plain
 * `query` returns nothing with no tenant bound. A test that read that as "the
 * row is absent" would pass for entirely the wrong reason, which is the
 * failure mode this helper exists to remove.
 */
async function asTenant(accountId, sql, params = []) {
  return withTenant(accountId, (client) => client.query(sql, params));
}

async function countRows(table, accountId) {
  const { rows } = await asTenant(
    accountId,
    `SELECT COUNT(*)::int AS c FROM ${table} WHERE account_id = $1`,
    [accountId],
  );
  return rows[0].c;
}

async function scanCount(accountId, standId) {
  const { rows } = await asTenant(accountId, 'SELECT scans_count FROM qr_stands WHERE id = $1', [
    standId,
  ]);
  return rows[0].scans_count;
}

function responseTokenHash(responseId) {
  return pii.lookupHash(responseId, 'public_response');
}

/**
 * The hashes the service would compute for an abandoned claim.
 *
 * Duplicated here on purpose: the takeover test has to seed a row the service
 * will recognise, and reaching into the service's private helpers to do it
 * would make the test pass for the wrong reason.
 */
function abandonedKeyHash(idempotencyKey) {
  return hashWith('idempotency_key', `stand:${tenantA.token}|session|${idempotencyKey}`);
}

function abandonedRequestHash() {
  return hashWith('idempotency_request', JSON.stringify({ locale: 'en' }));
}

function hashWith(domain, value) {
  return pii.lookupHash(value, domain);
}
