/**
 * Boots the real Express app for HTTP-level tests.
 *
 * Environment is set before importing anything, because config validation runs
 * at module load.
 *
 * These tests deliberately run with **no Postgres and no Redis**. The HTTP and
 * security contract must hold regardless of backing services, and being able to
 * prove that in CI without standing up infrastructure is what makes these
 * cheap enough to run on every push. Data-path coverage lives in
 * test/integration/database.test.js, which skips itself unless a live database
 * is provided.
 */

export function setTestEnv(overrides = {}) {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    JWT_SECRET: 'test-secret-value-that-is-comfortably-over-32-characters',
    PII_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/reviewboost_test',
    REDIS_URL: 'redis://127.0.0.1:6379',
    CORS_ORIGINS: 'http://localhost:5173',
    PUBLIC_API_URL: 'http://localhost:4000',
    PUBLIC_APP_URL: 'http://localhost:5173',
    SMS_DRY_RUN: 'true',
    ...overrides,
  });
}

export async function buildApp() {
  setTestEnv();
  const { createApp } = await import('../../src/http/app.js');
  return createApp();
}

/**
 * Absent Postgres and Redis produce connection errors on background sockets.
 * That noise is expected here; anything else must still fail the run.
 */
export function ignoreInfrastructureNoise(reason) {
  const message = reason instanceof Error ? reason.message : String(reason);
  const expected =
    /ECONNREFUSED|Connection is closed|Stream isn't writeable|Connection is aborted|enableOfflineQueue|Command timed out/i;

  if (!expected.test(message)) throw reason;
}

export async function teardown() {
  const { closePool } = await import('../../src/db/pool.js');
  const { closeQueues } = await import('../../src/queue/index.js');
  await Promise.allSettled([closeQueues(), closePool()]);
  // Let in-flight socket rejections settle against the guard above.
  await new Promise((resolve) => setTimeout(resolve, 50));
}
