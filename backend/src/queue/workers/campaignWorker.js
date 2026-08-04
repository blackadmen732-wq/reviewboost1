import { Worker } from 'bullmq';

import { logger } from '../../logger.js';
import * as accounts from '../../repositories/accountRepository.js';
import * as billing from '../../repositories/billingRepository.js';
import * as messaging from '../../repositories/messagingRepository.js';
import { isSubscriptionActive } from '../../services/billingService.js';
import { dispatchCampaign } from '../../services/campaignService.js';
import { QUEUE_NAMES, createRedisConnection } from '../index.js';

/**
 * Expands a campaign into per-message jobs.
 *
 * Kept separate from the SMS worker so a slow fan-out never blocks delivery,
 * and so the two can be scaled independently — fan-out is database-bound while
 * sending is provider-bound.
 */
export function createCampaignWorker() {
  const worker = new Worker(
    QUEUE_NAMES.campaign,
    async (job) => {
      const { accountId, campaignId } = job.data;

      // Second of the three kill-switch checks. A campaign queued while paid
      // must not dispatch after the subscription lapsed.
      const subscription = await billing.getSubscription(accountId);
      if (!isSubscriptionActive(subscription)) {
        await messaging.updateCampaignStatus(accountId, campaignId, 'paused');
        logger.warn('campaign.paused_inactive_subscription', { campaignId, accountId });
        return { skipped: 'subscription_inactive' };
      }

      const account = await accounts.getAccount(accountId);
      if (!account) return { skipped: 'account_missing' };

      const result = await dispatchCampaign({ accountId, campaignId, account });
      await messaging.refreshCampaignCounters(accountId, campaignId);
      return result;
    },
    { connection: createRedisConnection(), concurrency: 5 },
  );

  worker.on('failed', async (job, error) => {
    logger.error('campaign.job_failed', {
      campaignId: job?.data?.campaignId,
      attempts: job?.attemptsMade,
      message: error.message,
    });

    // Only mark the campaign failed once BullMQ has exhausted its retries —
    // otherwise a single transient error would strand a recoverable campaign.
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 1)) {
      await messaging
        .updateCampaignStatus(job.data.accountId, job.data.campaignId, 'failed')
        .catch(() => {});
    }
  });

  worker.on('error', (error) => logger.error('campaign.worker_error', { message: error.message }));

  return worker;
}
