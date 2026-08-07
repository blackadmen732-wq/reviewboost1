import { closePool } from './db/pool.js';
import { logger } from './logger.js';
import { closeQueues } from './queue/index.js';
import { expireLapsedTrials } from './repositories/billingRepository.js';
import { purgeCustomerFlowEphemera } from './repositories/customerFlowRepository.js';
import { purgeOldAttempts } from './repositories/securityRepository.js';
import { purgeExpiredTokens } from './repositories/sessionRepository.js';
import { purgeExpiredUserTokens } from './repositories/tokenRepository.js';
import { flushOutbox } from './services/emailService.js';

/**
 * Periodic maintenance. Run on a schedule (cron, ECS scheduled task, k8s Job):
 *
 *   npm run maintenance
 *
 * Every task is independent and idempotent, so one failing does not stop the
 * others and a re-run is always safe.
 */

const TASKS = [
  {
    name: 'expire_lapsed_trials',
    // The third leg of the kill switch. Stripe has no event for "a trial you
    // never attached a card to just ended", so nothing else catches these.
    run: async () => ({ expired: (await expireLapsedTrials()).length }),
  },
  {
    name: 'flush_email_outbox',
    run: () => flushOutbox({ batchSize: 100 }),
  },
  {
    name: 'purge_expired_sessions',
    run: async () => ({ purged: await purgeExpiredTokens() }),
  },
  {
    name: 'purge_expired_user_tokens',
    run: async () => ({ purged: await purgeExpiredUserTokens() }),
  },
  {
    name: 'purge_auth_attempts',
    run: () => purgeOldAttempts(),
  },
  {
    name: 'purge_customer_flow_ephemera',
    // Expires idempotency records and scrubs the short-lived client hash from
    // old sessions. Deliberately does not delete sessions or responses: those
    // are business history.
    run: () => purgeCustomerFlowEphemera(),
  },
];

export async function runMaintenance() {
  const results = {};

  for (const task of TASKS) {
    const startedAt = Date.now();
    try {
      results[task.name] = await task.run();
      logger.info('maintenance.task_complete', {
        task: task.name,
        durationMs: Date.now() - startedAt,
        ...results[task.name],
      });
    } catch (error) {
      results[task.name] = { error: error.message };
      logger.error('maintenance.task_failed', { task: task.name, message: error.message });
    }
  }

  return results;
}

if (process.argv[1]?.endsWith('maintenance.js')) {
  runMaintenance()
    .then(async (results) => {
      const failed = Object.values(results).some((result) => result?.error);
      await Promise.allSettled([closeQueues(), closePool()]);
      // Non-zero so a scheduler surfaces the failure rather than silently
      // succeeding every night.
      process.exit(failed ? 1 : 0);
    })
    .catch(async (error) => {
      logger.error('maintenance.fatal', { message: error.message });
      await Promise.allSettled([closeQueues(), closePool()]);
      process.exit(1);
    });
}
