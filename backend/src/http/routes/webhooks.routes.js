import express, { Router } from 'express';

import { classifyInboundKeyword } from '../../domain/compliance.js';
import { logger } from '../../logger.js';
import * as billingRepo from '../../repositories/billingRepository.js';
import * as messaging from '../../repositories/messagingRepository.js';
import { constructWebhookEvent, handleWebhookEvent } from '../../services/billingService.js';
import { normalizeProviderStatus, validateTwilioSignature } from '../../services/smsProvider.js';
import { asyncRoute } from '../middleware/core.js';

export const webhookRoutes = Router();

/**
 * Provider callbacks.
 *
 * Mounted before the JSON body parser: Stripe signature verification needs the
 * exact raw bytes, and any re-serialisation breaks it.
 */

// ----------------------------------------------------------------- stripe --

webhookRoutes.post(
  '/stripe',
  express.raw({ type: 'application/json', limit: '1mb' }),
  asyncRoute(async (req, res) => {
    let event;
    try {
      event = constructWebhookEvent(req.body, req.get('stripe-signature'));
    } catch (error) {
      logger.warn('billing.signature_invalid', { message: error.message });
      return res.status(400).send('Invalid signature.');
    }

    // Stripe delivers at least once; claiming the id makes handling exactly once.
    if (!(await billingRepo.claimStripeEvent(event.id, event.type))) {
      return res.json({ received: true, duplicate: true });
    }

    try {
      const result = await handleWebhookEvent(event);
      return res.json({ received: true, ...result });
    } catch (error) {
      // Release the claim and fail loudly so Stripe retries. Returning 200 here
      // would strand the account in the wrong billing state permanently, with
      // Stripe believing delivery succeeded.
      await billingRepo.releaseStripeEvent(event.id).catch(() => {});
      logger.error('billing.event_failed', { type: event.type, message: error.message });
      return res.status(500).send('Webhook processing failed.');
    }
  }),
);

// ----------------------------------------------------------------- twilio --

/** Twilio posts application/x-www-form-urlencoded. */
const twilioBody = express.urlencoded({ extended: false, limit: '256kb' });

/**
 * Signature verification uses the configured public URL rather than anything
 * reconstructed from the request, which would be http:// behind a
 * TLS-terminating proxy and never match what Twilio signed.
 */
function verifyTwilio(path) {
  return (req, res, next) => {
    const valid = validateTwilioSignature({
      signature: req.get('x-twilio-signature'),
      path,
      params: req.body,
    });

    if (!valid) {
      logger.warn('twilio.signature_invalid', { path });
      return res.status(403).send('Invalid signature.');
    }

    return next();
  };
}

webhookRoutes.post(
  '/twilio/status',
  twilioBody,
  verifyTwilio('/api/webhooks/twilio/status'),
  asyncRoute(async (req, res) => {
    const providerSid = req.body.MessageSid ?? req.body.SmsSid;
    const providerStatus = req.body.MessageStatus ?? req.body.SmsStatus;

    if (!providerSid || !providerStatus) return res.status(400).send('Missing status fields.');

    // Twilio retries callbacks, and they arrive out of order.
    if (!(await billingRepo.claimProviderEvent(`twilio:${providerSid}:${providerStatus}`, 'twilio'))) {
      return res.status(204).end();
    }

    const accountId = await messaging.recordDeliveryStatus(
      providerSid,
      normalizeProviderStatus(providerStatus),
      req.body.ErrorCode ?? null,
      req.body.ErrorMessage ?? null,
    );

    if (!accountId) logger.warn('twilio.unknown_message', { providerStatus });
    return res.status(204).end();
  }),
);

/**
 * Inbound SMS — the STOP/START/HELP path.
 *
 * Honouring an opt-out is a legal obligation, not a feature, so this replies
 * with TwiML confirming the action rather than silently absorbing it.
 */
webhookRoutes.post(
  '/twilio/inbound',
  twilioBody,
  verifyTwilio('/api/webhooks/twilio/inbound'),
  asyncRoute(async (req, res) => {
    const keyword = classifyInboundKeyword(req.body.Body);
    const originatingSid = req.body.OriginalRepliedMessageSid ?? null;

    let reply = 'Reply STOP to opt out of these messages.';

    if (keyword === 'stop') {
      if (originatingSid) {
        await messaging.suppressByProviderSid(originatingSid, 'stop_keyword');
      } else {
        // No thread reference to resolve the tenant from. Logged rather than
        // guessed at — suppressing the wrong account would be worse.
        logger.warn('twilio.stop_without_thread');
      }
      reply = 'You have been unsubscribed and will not receive further messages.';
    } else if (keyword === 'start') {
      reply = 'You are resubscribed. Reply STOP at any time to opt out.';
    } else if (keyword === 'help') {
      reply = 'ReviewBoost review requests. Reply STOP to opt out. Msg&data rates may apply.';
    }

    res
      .type('text/xml')
      .send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(reply)}</Message></Response>`);
  }),
);

function escapeXml(value) {
  return String(value).replace(
    /[<>&'"]/g,
    (character) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character],
  );
}
