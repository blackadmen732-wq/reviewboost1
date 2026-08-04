import { Router } from 'express';

import { config } from '../../config/index.js';
import { ensureOptOutNotice } from '../../domain/compliance.js';
import { priceMessage } from '../../domain/pricing.js';
import { renderTemplate } from '../../domain/templates.js';
import * as audit from '../../repositories/auditRepository.js';
import * as messaging from '../../repositories/messagingRepository.js';
import * as campaigns from '../../services/campaignService.js';
import { pii } from '../../services/encryption.js';
import { notFound } from '../errors.js';
import {
  enforceIpAllowlist,
  requireActiveSubscription,
  requireAuth,
  requireRole,
  requireVerifiedEmail,
} from '../middleware/auth.js';
import { asyncRoute, validate } from '../middleware/core.js';
import { campaignLimiter } from '../middleware/rateLimit.js';
import {
  createCampaignSchema,
  estimateCampaignSchema,
  paginationSchema,
  previewSchema,
  uuidParamSchema,
} from '../schemas.js';

export const campaignRoutes = Router();

campaignRoutes.use(requireAuth);
// After requireAuth, which is where req.auth.accountId comes from.
campaignRoutes.use(enforceIpAllowlist);

/** Cost and segment preview. Free, so no subscription gate. */
campaignRoutes.post(
  '/preview',
  validate(previewSchema),
  asyncRoute(async (req, res) => {
    const body = ensureOptOutNotice(
      renderTemplate(req.body.messageTemplate, {
        customer_name: req.body.sampleName || 'Alex',
        business_name: req.auth.account.business_name,
        review_link: req.body.reviewLink ?? req.auth.account.google_review_url,
      }),
    );

    const { segments, encoding, costInCents } = priceMessage(body, config.smsPricePerSegmentCents);

    res.json({
      body,
      characters: body.length,
      encoding,
      segments,
      costPerRecipientCents: costInCents,
    });
  }),
);

campaignRoutes.post(
  '/estimate',
  validate(estimateCampaignSchema),
  asyncRoute(async (req, res) => {
    res.json(campaigns.estimateCampaign({ account: req.auth.account, ...req.body }));
  }),
);

/**
 * Create and dispatch a campaign.
 *
 * Returns 202: the campaign is persisted and queued, but nothing has been sent
 * yet. Sending happens entirely in the worker.
 */
campaignRoutes.post(
  '/',
  requireRole('member'),
  requireVerifiedEmail,
  requireActiveSubscription,
  campaignLimiter,
  validate(createCampaignSchema),
  asyncRoute(async (req, res) => {
    const result = await campaigns.createCampaign({
      accountId: req.auth.accountId,
      userId: req.auth.userId,
      account: req.auth.account,
      ...req.body,
      scheduledAt: req.body.scheduledAt ? new Date(req.body.scheduledAt) : null,
    });

    await audit.record({
      accountId: req.auth.accountId,
      actorUserId: req.auth.userId,
      action: 'campaign.created',
      targetType: 'campaign',
      targetId: result.campaign.id,
      metadata: { recipients: result.queued, estimatedCostCents: result.estimatedCostCents },
    });

    res.status(202).json({
      campaign: result.campaign,
      queued: result.queued,
      skipped: result.skipped,
      invalid: result.invalid,
      estimatedCostCents: result.estimatedCostCents,
    });
  }),
);

campaignRoutes.get(
  '/',
  validate(paginationSchema, 'query'),
  asyncRoute(async (req, res) => {
    res.json(await messaging.listCampaigns(req.auth.accountId, req.validatedQuery));
  }),
);

campaignRoutes.get(
  '/:campaignId',
  validate(uuidParamSchema('campaignId'), 'params'),
  asyncRoute(async (req, res) => {
    const campaign = await messaging.refreshCampaignCounters(
      req.auth.accountId,
      req.params.campaignId,
    );
    if (!campaign) throw notFound('campaign_not_found', 'Campaign not found.');
    res.json({ campaign });
  }),
);

/**
 * Per-recipient detail.
 *
 * Phone numbers are decrypted only to a masked form — the dashboard never needs
 * the full number, so it never reaches the browser.
 */
campaignRoutes.get(
  '/:campaignId/messages',
  validate(uuidParamSchema('campaignId'), 'params'),
  validate(paginationSchema, 'query'),
  asyncRoute(async (req, res) => {
    const rows = await messaging.listCampaignMessages(
      req.auth.accountId,
      req.params.campaignId,
      req.validatedQuery,
    );

    res.json({
      messages: rows.map((row) => ({
        id: row.id,
        phone: maskDecrypted(row.phone_encrypted),
        status: row.status,
        segments: row.segment_count,
        costInCents: row.cost_in_cents,
        error: row.error_message,
        sentAt: row.sent_at,
        deliveredAt: row.delivered_at,
      })),
    });
  }),
);

function maskDecrypted(payload) {
  const plain = pii.tryDecrypt(payload);
  const digits = String(plain ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : null;
}
