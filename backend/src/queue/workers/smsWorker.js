import { Worker } from 'bullmq';

import { config } from '../../config/index.js';
import { priceMessage } from '../../domain/pricing.js';
import { logger } from '../../logger.js';
import * as billing from '../../repositories/billingRepository.js';
import * as messaging from '../../repositories/messagingRepository.js';
import { isSubscriptionActive } from '../../services/billingService.js';
import { pii } from '../../services/encryption.js';
import { getSmsProvider } from '../../services/smsProvider.js';
import { QUEUE_NAMES, createRedisConnection } from '../index.js';

/**
 * Sends one message per job.
 *
 * Ordering is the whole design. The provider call is the only irreversible
 * step, so everything that could reject the send happens before it, and the row
 * is marked sent immediately after. If the bookkeeping that follows fails, the
 * job retries — and the status guard at the top makes that redelivery a no-op
 * rather than a second text.
 */
export function createSmsWorker() {
  const worker = new Worker(
    QUEUE_NAMES.sms,
    async (job) => {
      const { accountId, messageId } = job.data;

      const message = await messaging.getMessageForSend(accountId, messageId);
      if (!message) {
        logger.warn('sms.message_missing', { messageId });
        return { skipped: 'not_found' };
      }

      // Redelivery guard: anything past 'queued' has already been sent.
      if (message.status !== 'queued') {
        return { skipped: `already_${message.status}` };
      }

      // The kill switch, re-checked here rather than only at request time. A
      // subscription can lapse between a campaign being created and its
      // messages actually going out.
      const subscription = await billing.getSubscription(accountId);
      if (!isSubscriptionActive(subscription)) {
        await messaging.markMessageStatus(accountId, messageId, 'failed', {
          errorCode: 'subscription_inactive',
          errorMessage: 'Subscription is not active.',
        });
        return { skipped: 'subscription_inactive' };
      }

      // Last-moment suppression check: the recipient may have replied STOP
      // after the campaign was built but before this job ran.
      const suppressed = await messaging.loadSuppressedLookups(accountId, [message.phone_lookup]);
      if (suppressed.has(message.phone_lookup)) {
        await messaging.markMessageStatus(accountId, messageId, 'suppressed', {
          errorCode: 'suppressed',
          errorMessage: 'Recipient has opted out.',
        });
        return { skipped: 'suppressed' };
      }

      const phone = pii.decrypt(message.phone_encrypted);
      const body = pii.decrypt(message.body_encrypted);
      const estimate = priceMessage(body, config.smsPricePerSegmentCents);

      const result = await getSmsProvider().send({
        to: phone,
        body,
        idempotencyKey: `msg-${messageId}`,
      });

      // Prefer what the provider actually charged over our estimate.
      const segments = result.numSegments ?? estimate.segments;
      const costInCents = result.providerPriceCents ?? estimate.costInCents;

      const recorded = await messaging.markMessageSent(accountId, messageId, {
        providerSid: result.providerSid,
        segments,
        costInCents,
      });

      // The guard means another worker won it first; do not double-count usage.
      if (recorded) await billing.recordUsageCost(accountId, segments, costInCents);

      return { sent: true, segments, costInCents };
    },
    {
      connection: createRedisConnection(),
      concurrency: config.smsWorkerConcurrency,
      // Carrier and Twilio throughput limits are per second, and exceeding them
      // gets numbers filtered rather than merely throttled.
      limiter: { max: config.smsPerSecondLimit, duration: 1000 },
    },
  );

  worker.on('failed', (job, error) => {
    logger.error('sms.job_failed', {
      messageId: job?.data?.messageId,
      attempts: job?.attemptsMade,
      message: error.message,
    });
  });

  worker.on('error', (error) => logger.error('sms.worker_error', { message: error.message }));

  return worker;
}
