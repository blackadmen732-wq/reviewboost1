import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import * as OTPAuth from 'otpauth';

import { config } from '../config/index.js';
import { query } from '../db/pool.js';
import { badRequest, conflict } from '../http/errors.js';
import { logger } from '../logger.js';
import { pii } from './encryption.js';

/**
 * Time-based one-time passwords (TOTP).
 *
 * Two design points carry most of the security value:
 *
 *   Enrolment is two-step. A secret is issued, and MFA only activates once the
 *   user proves they can generate a valid code from it. A one-step flow locks
 *   people out of their own accounts whenever setup goes wrong, and the support
 *   burden of that pushes teams toward unsafe recovery paths.
 *
 *   The last accepted time step is recorded. A TOTP code stays valid for its
 *   whole ~30 second window, so without this a code observed over someone's
 *   shoulder — or captured by a proxy — can be replayed within that window.
 */

const ISSUER = 'ReviewBoost';
const DIGITS = 6;
const PERIOD_SECONDS = 30;
// One step either side, tolerating ~30s of clock skew between phone and server.
const WINDOW = 1;
const RECOVERY_CODE_COUNT = 10;

function buildTotp(secretBase32, label) {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: label || 'account',
    algorithm: 'SHA1',
    digits: DIGITS,
    period: PERIOD_SECONDS,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

function currentStep() {
  return Math.floor(Date.now() / 1000 / PERIOD_SECONDS);
}

/** Recovery codes are credentials, so they are stored hashed like passwords. */
function hashRecoveryCode(code) {
  return createHmac('sha256', config.jwtSecret)
    .update(`recovery:${String(code).trim().toUpperCase()}`)
    .digest('hex');
}

function generateRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    // Grouped, because these get written on paper.
    randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g).join('-'),
  );
}

export async function getMfa(userId) {
  const { rows } = await query('SELECT * FROM user_mfa WHERE user_id = $1', [userId]);
  return rows[0] ?? null;
}

export async function isMfaEnabled(userId) {
  const { rows } = await query(
    'SELECT 1 FROM user_mfa WHERE user_id = $1 AND confirmed_at IS NOT NULL',
    [userId],
  );
  return rows.length > 0;
}

/** Step 1 — issue a secret. MFA is not active yet. */
export async function beginEnrolment({ userId, email }) {
  const existing = await getMfa(userId);
  if (existing?.confirmed_at) {
    throw conflict('mfa_already_enabled', 'Two-factor authentication is already on.');
  }

  const secret = new OTPAuth.Secret({ size: 20 }).base32;

  // Overwrites any abandoned enrolment, so a user who started setup twice is
  // not left with a stale secret that still works.
  await query(
    `INSERT INTO user_mfa (user_id, secret_encrypted)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE
       SET secret_encrypted = EXCLUDED.secret_encrypted,
           confirmed_at = NULL,
           recovery_code_hashes = '{}',
           recovery_codes_used = 0,
           last_used_step = NULL`,
    [userId, pii.encrypt(secret)],
  );

  return { secret, otpauthUrl: buildTotp(secret, email).toString() };
}

/** Step 2 — verify a code, then activate and issue recovery codes. */
export async function confirmEnrolment({ userId, email, code }) {
  const record = await getMfa(userId);
  if (!record) throw badRequest('mfa_not_started', 'Start two-factor setup first.');
  if (record.confirmed_at) {
    throw conflict('mfa_already_enabled', 'Two-factor authentication is already on.');
  }

  const secret = pii.decrypt(record.secret_encrypted);
  const delta = buildTotp(secret, email).validate({ token: String(code ?? '').trim(), window: WINDOW });

  if (delta === null) {
    throw badRequest('invalid_code', 'That code is not valid. Check your authenticator app.');
  }

  const recoveryCodes = generateRecoveryCodes();

  await query(
    `UPDATE user_mfa
        SET confirmed_at = now(),
            recovery_code_hashes = $2,
            last_used_step = $3
      WHERE user_id = $1`,
    [userId, recoveryCodes.map(hashRecoveryCode), currentStep() + delta],
  );

  logger.info('mfa.enabled', { userId });

  // Returned once and never again — only their hashes are retained.
  return { recoveryCodes };
}

/**
 * Verify a challenge: either a TOTP code or a recovery code.
 *
 * Returns rather than throws on a bad code, so the caller can record the failed
 * attempt against the account's lockout counter before responding.
 */
export async function verifyChallenge({ userId, email, code }) {
  const record = await getMfa(userId);
  if (!record?.confirmed_at) {
    throw badRequest('mfa_not_enabled', 'Two-factor authentication is not enabled.');
  }

  const submitted = String(code ?? '').trim().toUpperCase();
  if (!submitted) return { verified: false };

  // Recovery codes are hyphenated hex groups; TOTP codes are six digits.
  if (submitted.includes('-')) return verifyRecoveryCode(record, submitted);

  const secret = pii.decrypt(record.secret_encrypted);
  const delta = buildTotp(secret, email).validate({ token: submitted, window: WINDOW });
  if (delta === null) return { verified: false };

  const usedStep = currentStep() + delta;

  // Replay guard. Within a 30-second window the same code would otherwise be
  // accepted repeatedly.
  if (record.last_used_step !== null && Number(record.last_used_step) >= usedStep) {
    logger.warn('mfa.replay_blocked', { userId });
    return { verified: false, reason: 'code_already_used' };
  }

  await query('UPDATE user_mfa SET last_used_step = $2 WHERE user_id = $1', [userId, usedStep]);
  return { verified: true, method: 'totp' };
}

async function verifyRecoveryCode(record, submitted) {
  const submittedHash = hashRecoveryCode(submitted);
  const stored = record.recovery_code_hashes ?? [];

  // Constant-time comparison against each stored hash. The hashes are all the
  // same length, so timingSafeEqual is safe to call directly.
  const matchIndex = stored.findIndex((candidate) => {
    const a = Buffer.from(candidate, 'utf8');
    const b = Buffer.from(submittedHash, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  });

  if (matchIndex === -1) return { verified: false };

  // Single use — consume it.
  const remaining = stored.filter((_, index) => index !== matchIndex);
  await query(
    `UPDATE user_mfa
        SET recovery_code_hashes = $2, recovery_codes_used = recovery_codes_used + 1
      WHERE user_id = $1`,
    [record.user_id, remaining],
  );

  logger.warn('mfa.recovery_code_used', {
    userId: record.user_id,
    remaining: remaining.length,
  });

  return { verified: true, method: 'recovery_code', remainingRecoveryCodes: remaining.length };
}

/** Disabling requires a valid code, so a hijacked session cannot switch it off. */
export async function disable({ userId, email, code }) {
  const result = await verifyChallenge({ userId, email, code });
  if (!result.verified) throw badRequest('invalid_code', 'That code is not valid.');

  await query('DELETE FROM user_mfa WHERE user_id = $1', [userId]);
  logger.warn('mfa.disabled', { userId });
}

export async function regenerateRecoveryCodes({ userId, email, code }) {
  const result = await verifyChallenge({ userId, email, code });
  if (!result.verified) throw badRequest('invalid_code', 'That code is not valid.');

  const recoveryCodes = generateRecoveryCodes();
  await query(
    'UPDATE user_mfa SET recovery_code_hashes = $2, recovery_codes_used = 0 WHERE user_id = $1',
    [userId, recoveryCodes.map(hashRecoveryCode)],
  );

  return { recoveryCodes };
}

/** Exposed so unit tests can exercise the code maths without a database. */
export const __testing = { buildTotp, hashRecoveryCode, generateRecoveryCodes, currentStep };
