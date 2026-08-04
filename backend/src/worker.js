import { closePool } from './db/pool.js';
import { logger } from './logger.js';
import { closeQueues } from './queue/index.js';
import { createCampaignWorker } from './queue/workers/campaignWorker.js';
import { createSmsWorker } from './queue/workers/smsWorker.js';

/**
 * Worker entrypoint. Runs as a separate process from the API:
 *
 *   npm run worker
 *
 * Scale sending throughput horizontally by running more of these — BullMQ
 * distributes jobs across every consumer, and the per-message jobId keeps
 * delivery exactly-once regardless of how many are running.
 */

const workers = [createCampaignWorker(), createSmsWorker()];
logger.info('worker.started', { queues: workers.length });

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('worker.shutdown_started', { signal });

  const force = setTimeout(() => {
    logger.error('worker.shutdown_timeout');
    process.exit(1);
  }, 30_000);
  force.unref();

  // close() waits for in-flight jobs to finish, so a deploy never abandons a
  // half-sent message.
  await Promise.allSettled(workers.map((worker) => worker.close()));
  await Promise.allSettled([closeQueues(), closePool()]);

  logger.info('worker.shutdown_complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('worker.unhandled_rejection', {
    message: reason instanceof Error ? reason.message : String(reason),
  });
});
