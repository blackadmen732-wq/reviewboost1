import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { setTestEnv } from '../helpers/testApp.js';

/**
 * Data-layer tests against a real Postgres.
 *
 * Skipped unless TEST_DATABASE_URL is set, so the suite still runs with no
 * infrastructure. CI provides one via a service container.
 *
 *   TEST_DATABASE_URL=postgres://... npm run test:integration
 *
 * These cover the properties only a real database can prove: that Row Level
 * Security genuinely isolates tenants, that quota reservation is atomic under
 * concurrency, and that scan dedupe is race-free.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = DATABASE_URL ? false : 'TEST_DATABASE_URL is not set';

let pool;
let query;
let withTenant;
let accountA;
let accountB;

before(async () => {
  if (skip) return;

  setTestEnv({ DATABASE_URL });
  ({ pool, query, withTenant } = await import('../../src/db/pool.js'));

  const { runMigrations } = await import('../../src/db/migrate.js');
  await runMigrations();

  const a = await query(
    `INSERT INTO accounts (business_name, slug, google_review_url)
     VALUES ('Tenant A', 'tenant-a-test', 'https://g.page/a') RETURNING id`,
  );
  const b = await query(
    `INSERT INTO accounts (business_name, slug, google_review_url)
     VALUES ('Tenant B', 'tenant-b-test', 'https://g.page/b') RETURNING id`,
  );

  accountA = a.rows[0].id;
  accountB = b.rows[0].id;

  for (const id of [accountA, accountB]) {
    await query(
      `INSERT INTO billing_subscriptions (account_id, status, monthly_sms_allowance)
       VALUES ($1, 'active', 100)`,
      [id],
    );
  }
});

after(async () => {
  if (skip) return;
  await query('DELETE FROM accounts WHERE slug IN ($1, $2)', ['tenant-a-test', 'tenant-b-test']);
  await pool.end();
});

// Always runs, so a silently skipped suite is visible rather than looking green.
it('reports whether the database suite is enabled', () => {
  if (skip) {
    console.log('  [database suite SKIPPED] set TEST_DATABASE_URL to run RLS/quota/dedupe tests');
  }
  assert.ok(true);
});

describe('row level security', { skip }, () => {
  it('hides one tenant\'s rows from another', async () => {
    await withTenant(accountA, (client) =>
      client.query(
        `INSERT INTO contacts (account_id, phone_encrypted, phone_lookup)
         VALUES ($1, 'enc-a', 'lookup-a')`,
        [accountA],
      ),
    );

    const seenByB = await withTenant(accountB, (client) => client.query('SELECT * FROM contacts'));
    assert.equal(seenByB.rows.length, 0, 'tenant B must not see tenant A rows');

    const seenByA = await withTenant(accountA, (client) => client.query('SELECT * FROM contacts'));
    assert.equal(seenByA.rows.length, 1);
  });

  it('refuses a cross-tenant write even when the account_id is forged', async () => {
    await assert.rejects(
      withTenant(accountB, (client) =>
        client.query(
          `INSERT INTO contacts (account_id, phone_encrypted, phone_lookup)
           VALUES ($1, 'enc-x', 'lookup-x')`,
          // Tenant B claiming to be tenant A. WITH CHECK must reject it.
          [accountA],
        ),
      ),
      /row-level security/i,
    );
  });

  it('applies to the table owner, because FORCE is set', async () => {
    // Without FORCE, the migration runs as the owner and every policy is
    // silently inert — the schema looks correct and isolates nothing.
    const { rows } = await query(
      `SELECT relname, relrowsecurity, relforcerowsecurity
         FROM pg_class
        WHERE relname IN ('contacts','messages','campaigns','qr_stands','qr_scans',
                          'private_feedback','suppressions','usage_daily','audit_events')`,
    );

    assert.equal(rows.length, 9);
    for (const row of rows) {
      assert.equal(row.relrowsecurity, true, `${row.relname} must have RLS enabled`);
      assert.equal(row.relforcerowsecurity, true, `${row.relname} must have RLS forced`);
    }
  });

  it('does not leak tenant context between pooled connections', async () => {
    // set_config is transaction-local; a session-level setting would survive
    // the connection returning to the pool.
    await withTenant(accountA, (client) => client.query('SELECT 1'));
    const { rows } = await query("SELECT current_setting('app.current_account_id', true) AS ctx");
    assert.ok(!rows[0].ctx, 'tenant context must not persist outside the transaction');
  });
});

describe('quota reservation', { skip }, () => {
  it('is atomic under concurrency', async () => {
    // Allowance is 100. Ten concurrent requests for 20 each must not all win.
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        query('SELECT reserve_message_quota($1, $2) AS allowed', [accountB, 20]),
      ),
    );

    const granted = attempts.filter((result) => result.rows[0].allowed).length;
    assert.equal(granted, 5, 'exactly five reservations of 20 fit inside an allowance of 100');
  });

  it('rejects a request that would exceed the allowance', async () => {
    const { rows } = await query('SELECT reserve_message_quota($1, $2) AS allowed', [accountB, 1]);
    assert.equal(rows[0].allowed, false);
  });
});

describe('scan dedupe', { skip }, () => {
  it('counts one scan when the same device scans repeatedly', async () => {
    const stand = await withTenant(accountA, (client) =>
      client.query(
        `INSERT INTO qr_stands (account_id, public_id, label)
         VALUES ($1, 'test-public-id-1', 'Front') RETURNING id`,
        [accountA],
      ),
    );

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        query('SELECT register_scan($1, $2, $3, $4) AS recorded', [
          stand.rows[0].id,
          'same-ip-hash',
          'agent',
          'mobile',
        ]),
      ),
    );

    const recorded = results.filter((result) => result.rows[0].recorded).length;
    assert.equal(recorded, 1, 'concurrent scans from one device collapse to a single row');
  });
});

describe('account lockout', { skip }, () => {
  it('locks after the threshold and reports it', async () => {
    const email = `lockout-test-${Date.now()}@example.com`;
    await query(
      `INSERT INTO users (email, password_hash) VALUES ($1::citext, 'x')`,
      [email],
    );

    let locked = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const { rows } = await query('SELECT * FROM record_login_attempt($1::citext, $2, false, 10, 15)', [
        email,
        'ip-hash',
      ]);
      locked = rows[0].locked;
    }

    assert.equal(locked, true, 'the tenth failure must trip the lock');

    const { rows } = await query('SELECT locked_until FROM users WHERE email = $1::citext', [email]);
    assert.ok(rows[0].locked_until, 'lock expiry must be recorded on the user');

    await query('DELETE FROM users WHERE email = $1::citext', [email]);
  });
});
