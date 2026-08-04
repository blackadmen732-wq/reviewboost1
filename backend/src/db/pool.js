import pg from 'pg';

import { config } from '../config/index.js';
import { logger } from '../logger.js';

const { Pool, types } = pg;

/**
 * The single connection pool, and the tenant-scoping primitive built on it.
 *
 * Every query in this codebase goes through one of the three exports below.
 * `withTenant` is the important one: it is what makes Row Level Security
 * actually apply, and using `query` where `withTenant` was needed is the one
 * mistake that could leak one business's data to another.
 */

// COUNT() and BIGINT arrive as strings by default, because they can exceed
// Number.MAX_SAFE_INTEGER. Every counter in this schema is comfortably inside
// it, and string counts are a persistent source of `"5" + 1 === "51"` bugs.
types.setTypeParser(types.builtins.INT8, (value) => Number(value));

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.databasePoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // Managed Postgres commonly presents a certificate the container has no root
  // for. TLS is still negotiated; only the chain check is relaxed.
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
});

// An error on an *idle* client is emitted on the pool, not on any query. With
// no listener Node treats it as an unhandled 'error' event and kills the
// process — a database blip would take the API down.
pool.on('error', (error) => {
  logger.error('db.idle_client_error', { errorName: error.name, message: error.message });
});

/**
 * Run a query with no tenant context.
 *
 * Only for tables outside Row Level Security — users, sessions, billing — and
 * for SECURITY DEFINER functions that derive the tenant themselves. Using this
 * on a tenant table returns nothing, because the RLS policy has no account to
 * compare against.
 */
export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Run `callback` inside a transaction scoped to one tenant.
 *
 * The account id is bound to the `app.current_account_id` setting through
 * `set_config` with a *bound parameter* — never string interpolation, which
 * would be an injection vector on the one value that decides data isolation.
 *
 * The third argument to set_config is `true`, making it transaction-local. That
 * matters with a pool: a session-level setting would survive the connection
 * being returned and leak the tenant context into whichever request checked it
 * out next.
 */
export async function withTenant(accountId, callback) {
  if (!accountId) {
    throw new Error('withTenant requires an accountId — refusing to run unscoped.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.current_account_id', accountId]);

    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // Swallow a rollback failure: the original error is the useful one, and a
    // dead connection would otherwise mask it.
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Transaction without tenant scoping, for cross-tenant system work. */
export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function checkDatabase() {
  const { rows } = await pool.query('SELECT 1 AS ok');
  return rows[0]?.ok === 1;
}

export function poolStats() {
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
}

export async function closePool() {
  await pool.end();
}
