import QRCode from 'qrcode';

import { config } from '../config/index.js';
import { randomToken } from '../domain/crypto.js';
import { classifyDevice } from '../domain/deviceFingerprint.js';
import { normalizePhone } from '../domain/phone.js';
import { badRequest, notFound } from '../http/errors.js';
import { logger } from '../logger.js';
import * as qr from '../repositories/qrRepository.js';
import { isSubscriptionActive } from './billingService.js';
import { hashIp, pii } from './encryption.js';

/**
 * QR / NFC review gate.
 *
 * A scan lands on /q/:publicId. Ratings at or above the stand's threshold go
 * straight to the public Google review page; below it, the feedback is captured
 * privately so the business can fix the problem before it becomes a one-star
 * review.
 *
 * The public endpoints never accept an account id from the client and never
 * return one. The tenant is always derived server-side from the stand — the
 * alternative lets anyone who scans a code harvest the account id and write
 * unlimited fake feedback into that business.
 */

export function scanUrlFor(publicId) {
  const base = config.publicApiUrl ?? `http://localhost:${config.port}`;
  return `${base}/q/${publicId}`;
}

function decorate(stand) {
  return { ...stand, scan_url: scanUrlFor(stand.public_id) };
}

// -------------------------------------------------------- management ------

export async function createStand(accountId, input) {
  // 16 bytes of entropy. The public id is the only thing preventing a stand
  // from being enumerated and spammed with fabricated feedback.
  const publicId = randomToken(12);

  const stand = await qr.createStand(accountId, {
    publicId,
    label: String(input.label ?? 'Front Desk').slice(0, 80),
    destinationUrl: input.destinationUrl ?? null,
    primaryColor: input.primaryColor,
    backgroundColor: input.backgroundColor,
    reviewThreshold: input.reviewThreshold,
  });

  return decorate(stand);
}

export async function listStands(accountId) {
  return (await qr.listStands(accountId)).map(decorate);
}

export async function updateStand(accountId, standId, patch) {
  const stand = await qr.updateStand(accountId, standId, patch);
  if (!stand) throw notFound('stand_not_found', 'QR stand not found.');
  return decorate(stand);
}

export async function deleteStand(accountId, standId) {
  if (!(await qr.deleteStand(accountId, standId))) {
    throw notFound('stand_not_found', 'QR stand not found.');
  }
}

// ------------------------------------------------------------ exports -----

export async function renderPng(accountId, standId, { size = 512 } = {}) {
  const stand = await qr.getStand(accountId, standId);
  if (!stand) throw notFound('stand_not_found', 'QR stand not found.');

  return QRCode.toDataURL(scanUrlFor(stand.public_id), {
    width: size,
    margin: 2,
    // High correction, because these get printed and then scuffed, laminated,
    // or partially covered on a counter.
    errorCorrectionLevel: 'H',
    color: { dark: stand.primary_color, light: stand.background_color },
  });
}

export async function renderSvg(accountId, standId) {
  const stand = await qr.getStand(accountId, standId);
  if (!stand) throw notFound('stand_not_found', 'QR stand not found.');

  return QRCode.toString(scanUrlFor(stand.public_id), {
    type: 'svg',
    margin: 2,
    errorCorrectionLevel: 'H',
    color: { dark: stand.primary_color, light: stand.background_color },
  });
}

// --------------------------------------------------------- public path ----

/**
 * Resolve a scan.
 *
 * Returns exactly what the gate page needs and nothing more — notably not the
 * account id.
 */
export async function resolveScan({ publicId, ip, userAgent }) {
  const stand = await qr.resolveStandByPublicId(publicId);

  if (!stand || !stand.is_active) {
    throw notFound('stand_not_found', 'This QR code is not active.');
  }

  const deviceType = classifyDevice(userAgent);

  // Bots are resolved but never counted, so scan analytics stay meaningful.
  if (deviceType !== 'bot') {
    await qr
      .registerScan({ standId: stand.stand_id, ipHash: hashIp(ip), userAgent, deviceType })
      .catch((error) => logger.error('qr.scan_record_failed', { message: error.message }));
  }

  // Kill switch: an unpaid account keeps a working QR code but loses the
  // gating feature. The customer experience never breaks because the business
  // did not pay — they simply go straight to Google.
  const gateEnabled = isSubscriptionActive({
    status: stand.subscription_status,
    trial_ends_at: stand.trial_ends_at,
  });

  return {
    standId: stand.stand_id,
    businessName: stand.business_name,
    reviewUrl: stand.destination_url || stand.google_review_url,
    reviewThreshold: stand.review_threshold,
    gateEnabled,
  };
}

/**
 * Handle a rating submitted at the gate.
 *
 * The stand's public id is the only tenant input, and it is resolved
 * server-side.
 */
export async function submitRating({ publicId, rating, feedbackText, contactPhone, contactEmail }) {
  const stand = await qr.resolveStandByPublicId(publicId);
  if (!stand || !stand.is_active) {
    throw notFound('stand_not_found', 'This QR code is not active.');
  }

  const reviewUrl = stand.destination_url || stand.google_review_url;

  if (rating >= stand.review_threshold) {
    return { action: 'redirect', reviewUrl };
  }

  const text = String(feedbackText ?? '').trim();
  if (!text) throw badRequest('feedback_required', 'Please tell us what went wrong.');

  const phone = contactPhone ? normalizePhone(contactPhone) : '';

  await qr.submitPrivateFeedback({
    standId: stand.stand_id,
    rating,
    feedbackEncrypted: pii.encrypt(text.slice(0, 2000)),
    phoneEncrypted: phone ? pii.encrypt(phone) : null,
    emailEncrypted: contactEmail ? pii.encrypt(String(contactEmail).slice(0, 200)) : null,
  });

  logger.info('qr.feedback_intercepted', { standId: stand.stand_id, rating });
  return { action: 'captured' };
}

/** Decrypt stored feedback for the dashboard. */
export async function listFeedback(accountId, options) {
  const { feedback, total } = await qr.listFeedback(accountId, options);

  return {
    total,
    feedback: feedback.map((row) => ({
      id: row.id,
      rating: row.rating,
      // One row encrypted under a rotated key must not fail the whole listing.
      text: pii.tryDecrypt(row.feedback_encrypted, '[unable to decrypt]'),
      phone: row.phone_encrypted ? pii.tryDecrypt(row.phone_encrypted) : null,
      standLabel: row.stand_label,
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
    })),
  };
}
