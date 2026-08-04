import bcrypt from 'bcryptjs';

import { config } from '../config/index.js';
import { checkPasswordSafety } from '../domain/passwordSafety.js';
import { badRequest } from '../http/errors.js';
import { logger } from '../logger.js';

/**
 * The single gate every password passes through.
 *
 * Registration, reset, and change all call this. That is the point: the most
 * common way a strong password policy gets bypassed is a rigorous signup check
 * sitting next to a reset endpoint that only measures length.
 */

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

export async function assertPasswordAcceptable(password, context = {}) {
  const value = String(password ?? '');

  if (value.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(
      'weak_password',
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }

  // bcrypt silently truncates beyond 72 bytes; the cap is well below that, and
  // exists mainly to stop a multi-megabyte string reaching the hash function.
  if (value.length > MAX_PASSWORD_LENGTH) {
    throw badRequest('weak_password', `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`);
  }

  if (value !== value.trim()) {
    throw badRequest(
      'weak_password',
      'Password cannot start or end with a space — it is too easy to mistype.',
    );
  }

  const result = await checkPasswordSafety(value, context);

  if (!result.safe) {
    logger.info('password.rejected', { breached: result.breachCount > 0 });
    throw badRequest('breached_password', result.reason);
  }

  // The breach corpus was unreachable. Local checks still ran, but record the
  // gap so a sustained outage shows up in logs rather than quietly weakening
  // the policy for everyone who signs up during it.
  if (!result.checked) {
    logger.warn('password.breach_check_unavailable');
  }

  return result;
}

export function hashPassword(password) {
  return bcrypt.hash(password, config.bcryptRounds);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * A hash to compare against when the account does not exist.
 *
 * Without this, a missing email returns in ~1ms and a wrong password in ~100ms,
 * which is a reliable oracle for enumerating who has an account.
 */
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync('invalid-password-placeholder', 10);
