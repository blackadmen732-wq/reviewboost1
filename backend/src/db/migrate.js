import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { logger } from '../logger.js';
import { closePool, pool, withTransaction } from './pool.js';

/**
 * Migration runner.
 *
 * Deliberately minimal — no framework, no rollbacks. Rollback scripts are
 * rarely correct and rarely tested; the safer discipline is forward-only
 * migrations that are additive and reversible by deploying the previous
 * application version.
 *
 * Two properties matter:
 *
 *   Each migration runs in its own transaction, so a failure leaves the schema
 *   at the last good version rather than half-applied.
 *
 *   Each applied file's checksum is recorded, so editing a migration that has
 *   already run is caught rather than silently diverging environments.
 */

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations',
);

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

function checksum(sql) {
  return createHash('sha256').update(sql).digest('hex').slice(0, 16);
}

async function readMigrations() {
  const entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true });

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    // Lexicographic order, which the NNN_ prefix makes chronological.
    .sort((a, b) => a.name.localeCompare(b.name));

  return Promise.all(
    files.map(async (entry) => {
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, entry.name), 'utf8');
      return { name: entry.name, sql, checksum: checksum(sql) };
    }),
  );
}

/**
 * Compare what is on disk with what has been applied.
 *
 * A changed checksum means someone edited an already-applied migration. That
 * silently diverges environments — the edit runs on a fresh database and never
 * on an existing one — so it is reported as an error rather than ignored.
 */
export async function migrationStatus() {
  await ensureMigrationsTable();

  const available = await readMigrations();
  const { rows } = await pool.query('SELECT name, checksum FROM schema_migrations');
  const applied = new Map(rows.map((row) => [row.name, row.checksum]));

  const pending = [];
  const modified = [];

  for (const migration of available) {
    const appliedChecksum = applied.get(migration.name);
    if (appliedChecksum === undefined) pending.push(migration.name);
    else if (appliedChecksum !== migration.checksum) modified.push(migration.name);
  }

  // A file recorded as applied but no longer on disk usually means a bad merge.
  const missing = [...applied.keys()].filter(
    (name) => !available.some((migration) => migration.name === name),
  );

  return { pending, modified, missing, appliedCount: applied.size };
}

export async function runMigrations({ allowModified = false } = {}) {
  await ensureMigrationsTable();

  const status = await migrationStatus();

  if (status.modified.length > 0 && !allowModified) {
    throw new Error(
      `Already-applied migrations were edited: ${status.modified.join(', ')}. ` +
        'Add a new migration instead — editing an applied one diverges environments.',
    );
  }
  if (status.missing.length > 0) {
    logger.warn('migrate.missing_files', { missing: status.missing });
  }
  if (status.pending.length === 0) {
    logger.info('migrate.up_to_date', { applied: status.appliedCount });
    return [];
  }

  const available = await readMigrations();
  const applied = [];

  for (const name of status.pending) {
    const migration = available.find((candidate) => candidate.name === name);
    logger.info('migrate.applying', { name });

    const startedAt = Date.now();
    await withTransaction(async (client) => {
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
        migration.name,
        migration.checksum,
      ]);
    });

    logger.info('migrate.applied', { name, durationMs: Date.now() - startedAt });
    applied.push(name);
  }

  return applied;
}

// `npm run migrate`
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('migrate.js');

if (invokedDirectly) {
  runMigrations()
    .then(async (applied) => {
      logger.info('migrate.complete', { count: applied.length, applied });
      await closePool();
      process.exit(0);
    })
    .catch(async (error) => {
      logger.error('migrate.failed', { message: error.message });
      await closePool().catch(() => {});
      // Non-zero so a deploy pipeline halts instead of starting the API
      // against a half-migrated schema.
      process.exit(1);
    });
}
