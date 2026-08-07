import QRCode from 'qrcode';

import { config } from '../config/index.js';
import { randomToken } from '../domain/crypto.js';
import { notFound } from '../http/errors.js';
import * as qr from '../repositories/qrRepository.js';
import { pii } from './encryption.js';

/**
 * QR / NFC stand management.
 *
 * Creating stands, rendering them, and reading what customers left. The
 * customer-facing flow itself lives in customerFlowService.js.
 *
 * This module used to also serve the public rating gate, which routed high
 * ratings to Google and diverted low ones into a private form. That behaviour
 * is prohibited and has been removed: no stand carries a review threshold, and
 * nothing here decides where a customer goes based on the rating they chose.
 */

/**
 * The URL a printed code or an NFC tag resolves to.
 *
 * Built against the *frontend* origin. Pointing a physical stand at the API
 * would send customers to the old server-rendered gate, and a code already
 * printed and sitting on a table cannot be recalled — which is why the origin
 * is validated at boot rather than defaulted here.
 */
export function scanUrlFor(publicId) {
  return `${config.publicFrontendUrl}/q/${encodeURIComponent(publicId)}`;
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
