import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { config } from '../config/index.js';
import { logger } from '../logger.js';

/**
 * Redis and BullMQ wiring.
 *
 * Everything is created lazily. Importing a module must never open a socket: it
 * couples process startup to Redis availability, makes the HTTP layer
 * untestable without infrastructure, and connects Redis in processes
 * (migrations, one-shot scripts) that have no use for it.
 */

export const QUEUE_NAMES = Object.freeze({
  campaign: 'campaign-dispatch',
  sms: 'sms-send',
});

const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  // Without these, completed job records accumulate in Redis forever and the
  // instance eventually runs out of memory.
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86_400 * 7 },
};

/**
 * Connection for BullMQ.
 *
 * `maxRetriesPerRequest: null` is mandatory here — a queue command must never
 * be abandoned, or a job is silently lost.
 */
export function createRedisConnection() {
  const connection = new IORedis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
  });

  // An ioredis 'error' with no listener is an unhandled event that kills the
  // process.
  connection.on('error', (error) => {
    logger.error('redis.connection_error', { message: error.message });
  });

  return connection;
}

/**
 * Connection for rate limiting — the opposite trade-off.
 *
 * A limiter command must fail *fast* so the store can fall back to memory.
 * Using the queue's settings here would make every HTTP request hang for as
 * long as Redis was down.
 */
function createRateLimitConnection() {
  const connection = new IORedis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 1000,
    commandTimeout: 1000,
    retryStrategy: (attempt) => (attempt > 5 ? null : Math.min(attempt * 500, 3000)),
  });

  connection.on('error', (error) => {
    logger.debug('redis.ratelimit_error', { message: error.message });
  });

  return connection;
}

let sharedConnection = null;
let rateLimitConnection = null;
let campaignQueue = null;
let smsQueue = null;

export function getConnection() {
  sharedConnection ??= createRedisConnection();
  return sharedConnection;
}

export function getRateLimitConnection() {
  if (!rateLimitConnection) {
    rateLimitConnection = createRateLimitConnection();
    // lazyConnect means nothing dials until a command is issued. Kick the
    // connection off once here, with the rejection handled, so callers can
    // check `status` instead of discovering the outage by issuing a command
    // that throws from inside a third-party library.
    rateLimitConnection.connect().catch(() => {});
  }
  return rateLimitConnection;
}

/**
 * Issue a rate-limit command, or fail fast if Redis is not connected.
 *
 * Gating on status rather than letting the command through matters: with
 * enableOfflineQueue disabled, ioredis throws from inside rate-limit-redis,
 * where the promise floats and surfaces as an unhandled rejection rather than
 * something the resilient store can catch.
 */
export function rateLimitRedisReady() {
  return getRateLimitConnection().status === 'ready';
}

export async function rateLimitCommand(...args) {
  const connection = getRateLimitConnection();

  if (connection.status !== 'ready') {
    const error = new Error(`Redis is ${connection.status}, not ready.`);
    error.code = 'REDIS_NOT_READY';
    throw error;
  }

  return connection.call(...args);
}

export function getCampaignQueue() {
  campaignQueue ??= new Queue(QUEUE_NAMES.campaign, {
    connection: getConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  return campaignQueue;
}

export function getSmsQueue() {
  smsQueue ??= new Queue(QUEUE_NAMES.sms, {
    connection: getConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  return smsQueue;
}

/** Hand a campaign to the workers. Returns immediately. */
export function enqueueCampaign({ accountId, campaignId }) {
  return getCampaignQueue().add(
    'dispatch',
    { accountId, campaignId },
    // The campaign id is the natural idempotency key: enqueueing twice must not
    // produce two dispatch runs.
    { jobId: `campaign:${campaignId}` },
  );
}

/**
 * Queue messages for delivery.
 *
 * `jobId` derives from the message row id, so a duplicated enqueue — from a
 * retry, a redeploy, or a double click — collapses to a single send. Texting
 * someone twice costs money and is a compliance problem.
 */
export function enqueueMessages(entries) {
  if (entries.length === 0) return Promise.resolve([]);

  return getSmsQueue().addBulk(
    entries.map(({ accountId, messageId, delayMs = 0 }) => ({
      name: 'send',
      data: { accountId, messageId },
      opts: { jobId: `message:${messageId}`, delay: delayMs },
    })),
  );
}

export async function queueDepths() {
  const [campaign, sms] = await Promise.all([
    getCampaignQueue().getJobCounts('waiting', 'active', 'delayed', 'failed'),
    getSmsQueue().getJobCounts('waiting', 'active', 'delayed', 'failed'),
  ]);
  return { campaign, sms };
}

async function closeClient(client) {
  if (!client) return;
  try {
    // quit() waits for a graceful round trip, which never completes if the
    // connection is down. disconnect() stops the retry loop, which is what
    // actually lets the process exit.
    if (client.status === 'ready') await client.quit();
    else client.disconnect();
  } catch {
    client.disconnect();
  }
}

export async function closeQueues() {
  await Promise.allSettled([campaignQueue?.close(), smsQueue?.close()].filter(Boolean));
  await closeClient(sharedConnection);
  await closeClient(rateLimitConnection);

  campaignQueue = null;
  smsQueue = null;
  sharedConnection = null;
  rateLimitConnection = null;
}
