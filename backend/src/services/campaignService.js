import { config } from '../config/index.js';
import {
  ensureOptOutNotice,
  evaluateSendEligibility,
  millisecondsUntilSendingWindow,
} from '../domain/compliance.js';
import { normalizePhone, phoneDedupeKey } from '../domain/phone.js';
import { priceMessage } from '../domain/pricing.js';
import { renderTemplate } from '../domain/templates.js';
import { AppError, badRequest, notFound, paymentRequired } from '../http/errors.js';
import { logger } from '../logger.js';
import { enqueueCampaign, enqueueMessages } from '../queue/index.js';
import * as billing from '../repositories/billingRepository.js';
import * as messaging from '../repositories/messagingRepository.js';
import { hashPhone, pii } from './encryption.js';

/**
 * Campaign creation and dispatch.
 *
 * The performance property that matters: creating a campaign costs a *fixed*
 * number of database round trips regardless of recipient count. The previous
 * implementation did several reads and writes per recipient inside the HTTP
 * request, which is quadratic — 500 recipients took eleven seconds with no
 * network I/O at all, and any real send would have exceeded a proxy timeout
 * mid-campaign with no way to know who had already been texted.
 *
 * Now: two bulk lookups, one atomic quota reservation, one bulk insert, one
 * enqueue. The request returns 202 in milliseconds and nothing is sent inline.
 */

/**
 * Normalise raw recipient input.
 *
 * Rejections are reported with their original index rather than dropped, so a
 * user who uploads 500 contacts is told which 40 had a typo instead of
 * silently texting 460.
 */
export function prepareRecipients(rawRecipients) {
  const valid = [];
  const invalid = [];
  const seen = new Map();

  rawRecipients.forEach((entry, index) => {
    const phone = normalizePhone(entry?.phone);

    if (!phone) {
      invalid.push({ index, reason: 'invalid_phone' });
      return;
    }

    const dedupeKey = phoneDedupeKey(phone);
    if (seen.has(dedupeKey)) {
      invalid.push({ index, reason: 'duplicate_in_request', duplicateOfIndex: seen.get(dedupeKey) });
      return;
    }
    seen.set(dedupeKey, index);

    valid.push({
      phone,
      dedupeKey,
      name: String(entry?.name ?? '').trim().slice(0, 80),
      consent: entry?.consent === true,
      consentSource: entry?.consentSource ? String(entry.consentSource).slice(0, 80) : null,
      consentAt: entry?.consentAt ? new Date(entry.consentAt) : null,
      timezone: entry?.timezone ? String(entry.timezone).slice(0, 60) : null,
    });
  });

  return { valid, invalid };
}

export async function createCampaign({
  accountId,
  userId,
  account,
  name,
  messageTemplate,
  reviewLink,
  recipients,
  requireConsent = true,
  scheduledAt = null,
}) {
  const { valid, invalid } = prepareRecipients(recipients);

  if (valid.length === 0) {
    throw badRequest('no_valid_recipients', 'No recipients had a usable phone number.', { invalid });
  }
  if (valid.length > config.maxRecipientsPerCampaign) {
    throw badRequest(
      'too_many_recipients',
      `A campaign may target at most ${config.maxRecipientsPerCampaign} recipients.`,
    );
  }

  const lookups = valid.map((entry) => hashPhone(entry.dedupeKey));
  const dedupeCutoff = new Date(Date.now() - config.duplicateWindowDays * 86_400_000).toISOString();

  // Two bulk queries, replacing what used to be two queries per recipient.
  const [suppressed, recentlyMessaged] = await Promise.all([
    messaging.loadSuppressedLookups(accountId, lookups),
    messaging.findRecentRecipients(accountId, lookups, dedupeCutoff),
  ]);

  const now = new Date();
  const rendered = [];
  const skipped = { suppressed: 0, duplicate: 0, no_consent: 0 };

  for (const entry of valid) {
    const lookup = hashPhone(entry.dedupeKey);

    const eligibility = evaluateSendEligibility({
      contact: {
        consent: entry.consent,
        consent_at: entry.consentAt,
        timezone: entry.timezone ?? account.timezone,
      },
      isSuppressed: suppressed.has(lookup),
      recentlyMessaged: recentlyMessaged.has(lookup),
      requireConsent,
      now,
      timezone: account.timezone,
      quietHoursStart: config.quietHoursStart,
      quietHoursEnd: config.quietHoursEnd,
    });

    if (!eligibility.allowed) {
      for (const reason of eligibility.reasons) {
        if (skipped[reason] !== undefined) skipped[reason] += 1;
      }
      continue;
    }

    // renderTemplate throws on an unknown or unfilled variable, which is a
    // template problem rather than a per-recipient one — let it propagate.
    const body = ensureOptOutNotice(
      renderTemplate(messageTemplate, {
        customer_name: entry.name || 'there',
        business_name: account.business_name,
        review_link: reviewLink,
      }),
    );

    const { segments, encoding, costInCents } = priceMessage(body, config.smsPricePerSegmentCents);

    rendered.push({
      phoneEncrypted: pii.encrypt(entry.phone),
      phoneLookup: lookup,
      bodyEncrypted: pii.encrypt(body),
      status: 'queued',
      segmentCount: segments,
      encoding,
      costInCents,
      deferMs: eligibility.deferMs,
    });
  }

  if (rendered.length === 0) {
    throw badRequest(
      'all_recipients_filtered',
      'Every recipient was suppressed, already contacted recently, or had no recorded consent.',
      skipped,
    );
  }

  // Reserved atomically before anything is created, so two concurrent campaigns
  // cannot both pass a check-then-act test and jointly exceed the allowance.
  if (!(await billing.reserveQuota(accountId, rendered.length))) {
    throw paymentRequired(
      'quota_exceeded',
      'This campaign exceeds your remaining monthly message allowance.',
    );
  }

  const estimatedCostCents = rendered.reduce((total, message) => total + message.costInCents, 0);

  try {
    const campaign = await messaging.createCampaign(accountId, {
      name,
      messageTemplate,
      reviewLink,
      status: scheduledAt ? 'draft' : 'queued',
      totalRecipients: rendered.length,
      estimatedCostCents,
      scheduledAt,
      createdBy: userId,
    });

    await messaging.insertCampaignMessages(accountId, campaign.id, rendered);

    if (!scheduledAt) await enqueueCampaign({ accountId, campaignId: campaign.id });

    logger.info('campaign.created', {
      campaignId: campaign.id,
      recipients: rendered.length,
      estimatedCostCents,
      skipped,
    });

    return { campaign, queued: rendered.length, skipped, invalid, estimatedCostCents };
  } catch (error) {
    // Give the quota back if anything failed after reserving it, or the account
    // is silently billed for messages that were never created.
    await billing.releaseQuota(accountId, rendered.length).catch(() => {});
    throw error;
  }
}

/**
 * Fan a campaign out into per-message jobs.
 *
 * Called by the worker, never by a request. Pages through the campaign so a
 * 5,000-recipient run is fully dispatched without holding it all in memory.
 */
export async function dispatchCampaign({ accountId, campaignId, account }) {
  const campaign = await messaging.getCampaign(accountId, campaignId);
  if (!campaign) throw notFound('campaign_not_found', 'Campaign not found.');

  await messaging.updateCampaignStatus(accountId, campaignId, 'running', { startedAt: new Date() });

  const timezone = account?.timezone ?? 'UTC';
  // Outside the legal window the whole batch is deferred rather than dropped,
  // so an overnight campaign lands first thing in the morning.
  const delayMs = millisecondsUntilSendingWindow(
    new Date(),
    timezone,
    config.quietHoursStart,
    config.quietHoursEnd,
  );

  const PAGE_SIZE = 500;
  let dispatched = 0;
  let offset = 0;

  for (;;) {
    const page = await messaging.listCampaignMessages(accountId, campaignId, {
      limit: PAGE_SIZE,
      offset,
    });
    if (page.length === 0) break;

    const pending = page
      .filter((message) => message.status === 'queued')
      .map((message) => ({ accountId, messageId: message.id, delayMs }));

    await enqueueMessages(pending);
    dispatched += pending.length;

    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  logger.info('campaign.dispatched', { campaignId, dispatched, delayMs });
  return { dispatched, delayMs };
}

/** Estimate cost without committing to anything. */
export function estimateCampaign({ account, messageTemplate, reviewLink, recipients }) {
  const { valid, invalid } = prepareRecipients(recipients ?? []);

  let segments = 0;
  let costInCents = 0;

  for (const entry of valid) {
    const body = ensureOptOutNotice(
      renderTemplate(messageTemplate, {
        customer_name: entry.name || 'there',
        business_name: account.business_name,
        review_link: reviewLink ?? account.google_review_url,
      }),
    );
    const priced = priceMessage(body, config.smsPricePerSegmentCents);
    segments += priced.segments;
    costInCents += priced.costInCents;
  }

  return { recipients: valid.length, invalid: invalid.length, segments, estimatedCostCents: costInCents };
}

export { AppError };
