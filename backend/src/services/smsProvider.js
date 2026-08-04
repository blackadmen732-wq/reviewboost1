import { randomUUID } from 'node:crypto';

import twilio from 'twilio';

import { config } from '../config/index.js';
import { logger } from '../logger.js';

/**
 * SMS delivery.
 *
 * Two implementations behind one interface, so dry-run exercises the same code
 * path as production rather than a separate branch that drifts. Twilio's status
 * vocabulary is mapped into our `message_status` enum in exactly one place.
 */

const PROVIDER_STATUS = {
  accepted: 'queued',
  scheduled: 'queued',
  queued: 'queued',
  sending: 'queued',
  sent: 'sent',
  receiving: 'sent',
  delivered: 'delivered',
  read: 'delivered',
  undelivered: 'failed',
  failed: 'failed',
  canceled: 'failed',
};

export function normalizeProviderStatus(status) {
  return PROVIDER_STATUS[String(status ?? '').toLowerCase()] ?? 'queued';
}

/** Twilio prices are negative decimal USD strings, e.g. "-0.0079". */
function priceToCents(price) {
  if (price === null || price === undefined || price === '') return null;
  const value = Number(price);
  if (!Number.isFinite(value)) return null;
  return Math.round(Math.abs(value) * 100);
}

class DryRunProvider {
  get isDryRun() {
    return true;
  }

  async send({ to }) {
    logger.debug('sms.dry_run_send', { to: '[redacted]' });
    return {
      providerSid: `dry_${randomUUID()}`,
      status: 'sent',
      providerStatus: 'sent',
      // Dry-run reports no price, so the caller falls back to our own
      // segment-based estimate — exercising that path too.
      providerPriceCents: null,
      numSegments: null,
    };
  }

  async fetchStatus() {
    return { status: 'delivered', providerStatus: 'delivered', errorCode: null, errorMessage: null };
  }
}

/**
 * Build the Twilio client.
 *
 * API Key authentication is preferred: the key is scoped and revocable on its
 * own, whereas leaking the Auth Token compromises the entire account. An API
 * Key must be paired with the Account SID so Twilio knows which account it acts
 * on — the key alone is not enough.
 */
function createTwilioClient() {
  if (config.twilioUsesApiKey) {
    return twilio(config.twilioApiKeySid, config.twilioApiKeySecret, {
      accountSid: config.twilioAccountSid,
    });
  }
  return twilio(config.twilioAccountSid, config.twilioAuthToken);
}

class TwilioProvider {
  #client;

  constructor() {
    this.#client = createTwilioClient();
  }

  get isDryRun() {
    return false;
  }

  get statusCallbackUrl() {
    return config.publicApiUrl ? `${config.publicApiUrl}/api/webhooks/twilio/status` : undefined;
  }

  async send({ to, body, idempotencyKey }) {
    const message = await this.#client.messages.create(
      {
        to,
        body,
        from: config.twilioFromNumber,
        ...(this.statusCallbackUrl ? { statusCallback: this.statusCallbackUrl } : {}),
      },
      // Makes the provider itself reject a duplicate if a job is redelivered
      // after the API call but before we recorded the result.
      idempotencyKey ? { idempotencyKey } : undefined,
    );

    return {
      providerSid: message.sid,
      status: normalizeProviderStatus(message.status),
      providerStatus: message.status,
      providerPriceCents: priceToCents(message.price),
      numSegments: message.numSegments ? Number(message.numSegments) : null,
    };
  }

  async fetchStatus(providerSid) {
    const message = await this.#client.messages(providerSid).fetch();
    return {
      status: normalizeProviderStatus(message.status),
      providerStatus: message.status,
      errorCode: message.errorCode ? String(message.errorCode) : null,
      errorMessage: message.errorMessage ?? null,
    };
  }
}

let provider = null;

export function getSmsProvider() {
  provider ??= config.smsDryRun ? new DryRunProvider() : new TwilioProvider();
  return provider;
}

/**
 * Validate an inbound Twilio webhook signature.
 *
 * The URL must be the public one Twilio signed. Behind a TLS-terminating proxy
 * the request Express sees is plain http, so reconstructing it from the request
 * would never match — this always uses the configured public URL.
 */
export function validateTwilioSignature({ signature, path, params }) {
  if (config.smsDryRun) return true;
  if (!config.publicApiUrl || !signature) return false;

  // Twilio signs with the account Auth Token specifically. An API Key secret
  // cannot verify a webhook, so without the Auth Token every callback must be
  // rejected rather than trusted.
  if (!config.twilioCanVerifyWebhooks) return false;

  return twilio.validateRequest(
    config.twilioAuthToken,
    signature,
    `${config.publicApiUrl}${path}`,
    params ?? {},
  );
}
