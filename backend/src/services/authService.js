import jwt from 'jsonwebtoken';

import { config } from '../config/index.js';
import { hashToken, randomToken } from '../domain/crypto.js';
import { describeDevice, fingerprintDevice } from '../domain/deviceFingerprint.js';
import { AppError, conflict, forbidden, locked, notFound, unauthorized } from '../http/errors.js';
import { logger } from '../logger.js';
import * as accounts from '../repositories/accountRepository.js';
import * as security from '../repositories/securityRepository.js';
import * as sessions from '../repositories/sessionRepository.js';
import { hashIp, pii } from './encryption.js';
import * as mfa from './mfaService.js';
import * as notify from './securityNotifications.js';
import {
  DUMMY_PASSWORD_HASH,
  assertPasswordAcceptable,
  hashPassword,
  verifyPassword,
} from './passwordPolicy.js';

/**
 * Authentication.
 *
 * Two token types with deliberately different properties:
 *
 *   Access token   Short-lived JWT, 15 minutes. Carries identity. Stateless and
 *                  therefore not individually revocable — which is why it is
 *                  short-lived, and why `token_version` exists as a bulk kill
 *                  switch for the cases that cannot wait.
 *
 *   Refresh token  Long-lived opaque random value, stored only as an HMAC.
 *                  Rotates on every use. This is what actually gets revoked.
 *
 * Rotation with reuse detection is the important part: the legitimate client
 * and a thief cannot both hold the current token, so a presented-but-revoked
 * token proves a leak and revokes the whole family.
 */

const ACCESS_AUDIENCE = 'reviewboost:api';
// A distinct audience, so a challenge token can never be presented as an access
// token and an access token can never satisfy a challenge.
const MFA_CHALLENGE_AUDIENCE = 'reviewboost:mfa-challenge';
const MFA_CHALLENGE_TTL_SECONDS = 300;

// ---------------------------------------------------------------- tokens ---

export function signAccessToken({ userId, accountId, role, tokenVersion }) {
  return jwt.sign({ sub: userId, act: accountId, role, tv: tokenVersion }, config.jwtSecret, {
    expiresIn: config.accessTokenTtlSeconds,
    audience: ACCESS_AUDIENCE,
    issuer: ACCESS_AUDIENCE,
  });
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret, {
      audience: ACCESS_AUDIENCE,
      issuer: ACCESS_AUDIENCE,
      algorithms: ['HS256'],
    });
  } catch {
    // Callers only need "valid or not"; the distinction between expired and
    // forged is not something to expose.
    return null;
  }
}

function signMfaChallenge({ userId, accountId }) {
  return jwt.sign({ sub: userId, act: accountId }, config.jwtSecret, {
    expiresIn: MFA_CHALLENGE_TTL_SECONDS,
    audience: MFA_CHALLENGE_AUDIENCE,
    issuer: ACCESS_AUDIENCE,
  });
}

function verifyMfaChallenge(token) {
  try {
    return jwt.verify(token, config.jwtSecret, {
      audience: MFA_CHALLENGE_AUDIENCE,
      issuer: ACCESS_AUDIENCE,
      algorithms: ['HS256'],
    });
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- helpers ---

function slugify(businessName) {
  const base = String(businessName)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return base.length >= 3 ? base : `biz-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

async function allocateSlug(businessName) {
  const base = slugify(businessName);
  if (!(await accounts.slugExists(base))) return base;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '');
    const candidate = `${base}-${suffix}`.slice(0, 63);
    if (!(await accounts.slugExists(candidate))) return candidate;
  }

  throw conflict('slug_unavailable', 'Could not allocate an account identifier. Try again.');
}

async function issueSession({ user, accountId, role, userAgent, ipHash, replacedTokenId = null }) {
  const refreshToken = randomToken(48);
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * 86_400_000);

  await sessions.createRefreshToken({
    userId: user.id,
    accountId,
    tokenHash: hashToken(refreshToken, config.jwtSecret),
    expiresAt,
    userAgent,
    ipHash,
    deviceLabel: describeDevice(userAgent),
    replacedTokenId,
  });

  return {
    accessToken: signAccessToken({
      userId: user.id,
      accountId,
      role,
      tokenVersion: user.token_version,
    }),
    refreshToken,
    expiresAt,
  };
}

/**
 * Record the sign-in and report whether this device is new.
 *
 * Never allowed to fail a valid login — activity logging is diagnostic, and an
 * outage in it must not lock users out.
 */
async function recordSignIn({ userId, accountId, userAgent, ipHash, eventType = 'login' }) {
  try {
    const fingerprint = fingerprintDevice({
      userAgent,
      ip: ipHash,
      hasher: (value, domain) => pii.lookupHash(value, domain),
    });

    const { isNewDevice } = await security.recordSecurityEvent({
      userId,
      accountId,
      eventType,
      ipHash,
      fingerprint,
      deviceLabel: describeDevice(userAgent),
      userAgent,
    });

    return isNewDevice;
  } catch (error) {
    logger.error('security.sign_in_record_failed', { message: error.message });
    return false;
  }
}

// -------------------------------------------------------------- register ---

export async function register({
  businessName,
  email,
  password,
  fullName,
  googleReviewUrl,
  timezone,
  userAgent,
  ipHash,
}) {
  // Signup cannot be throttled by email — an attacker varies it freely — so a
  // per-source cap is the only thing bounding automated account creation.
  if (ipHash && !(await security.allowRegistration(ipHash, {
    max: config.registrationsPerHourPerIp,
  }))) {
    throw new AppError(
      429,
      'registration_rate_limited',
      'Too many accounts created from this network. Try again later.',
    );
  }

  if (await accounts.findUserByEmail(email)) {
    throw conflict('email_taken', 'An account with that email already exists.');
  }

  // Identical policy to reset and change. A rigorous signup check beside a lax
  // reset endpoint is the usual way this gets bypassed.
  await assertPasswordAcceptable(password, { email, businessName });

  const passwordHash = await hashPassword(password);
  const slug = await allocateSlug(businessName);

  let created;
  try {
    created = await accounts.createAccountWithOwner({
      businessName,
      slug,
      googleReviewUrl,
      timezone: timezone || 'UTC',
      email,
      passwordHash,
      fullName,
      trialDays: config.trialDays,
      monthlySmsAllowance: 500,
    });
  } catch (error) {
    // Someone registered the same email between the check above and this insert.
    if (error.code === '23505') {
      throw conflict('email_taken', 'An account with that email already exists.');
    }
    throw error;
  }

  const session = await issueSession({
    user: created.user,
    accountId: created.account.id,
    role: 'owner',
    userAgent,
    ipHash,
  });

  await recordSignIn({
    userId: created.user.id,
    accountId: created.account.id,
    userAgent,
    ipHash,
    eventType: 'register',
  });

  logger.info('auth.registered', { accountId: created.account.id });

  return { ...session, account: created.account, user: created.user, role: 'owner' };
}

// ----------------------------------------------------------------- login ---

export async function login({ email, password, userAgent, ipHash }) {
  // Checked before any password work, so a locked account cannot be probed at
  // all — not even for timing.
  if (await security.getLockout(email)) {
    throw locked(
      'account_locked',
      'Too many failed sign-in attempts. This account is temporarily locked.',
    );
  }

  const user = await accounts.findUserByEmail(email);

  // Always runs a comparison, even with no user, so a missing account costs the
  // same wall-clock time as a wrong password.
  const passwordMatches = await verifyPassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);

  if (!user || !passwordMatches) {
    const outcome = await security.recordLoginAttempt({
      email,
      ipHash,
      succeeded: false,
      threshold: config.loginLockoutThreshold,
      lockMinutes: config.loginLockoutMinutes,
    });

    if (outcome.locked) {
      // Out-of-band, because the person being attacked is not the one holding
      // the browser making these attempts.
      if (user) {
        notify.notifyAccountLocked({
          email: user.email,
          attempts: outcome.recent_failures,
          lockMinutes: config.loginLockoutMinutes,
        });
      }

      throw locked(
        'account_locked',
        'Too many failed sign-in attempts. This account is temporarily locked.',
      );
    }

    throw unauthorized('invalid_credentials', 'Email or password is incorrect.');
  }

  const memberships = await accounts.listMembershipsForUser(user.id);
  if (memberships.length === 0) {
    throw forbidden('no_account', 'This user is not a member of any account.');
  }

  const primary = memberships[0];

  // Second factor required. The password was correct, but no session is issued
  // and no cookie is set until the challenge is answered.
  if (await mfa.isMfaEnabled(user.id)) {
    return {
      mfaRequired: true,
      challengeToken: signMfaChallenge({ userId: user.id, accountId: primary.account_id }),
      user: { id: user.id, email: user.email },
    };
  }

  await security.recordLoginAttempt({ email, ipHash, succeeded: true });
  await accounts.recordLogin(user.id);

  const session = await issueSession({
    user,
    accountId: primary.account_id,
    role: primary.role,
    userAgent,
    ipHash,
  });

  if (await recordSignIn({ userId: user.id, accountId: primary.account_id, userAgent, ipHash })) {
    notify.notifyNewDevice({ email: user.email, deviceLabel: describeDevice(userAgent) });
  }

  return {
    ...session,
    user: { id: user.id, email: user.email, fullName: user.full_name },
    memberships,
    role: primary.role,
    accountId: primary.account_id,
  };
}

/** Second step of a two-factor sign-in. */
export async function completeMfaChallenge({ challengeToken, code, userAgent, ipHash }) {
  const claims = verifyMfaChallenge(challengeToken);
  if (!claims?.sub) {
    throw unauthorized('challenge_expired', 'That sign-in attempt expired. Please start again.');
  }

  const user = await accounts.findUserById(claims.sub);
  if (!user) throw unauthorized('challenge_invalid', 'That sign-in attempt is not valid.');

  const result = await mfa.verifyChallenge({ userId: user.id, email: user.email, code });

  if (!result.verified) {
    // Counted against the same lockout as a wrong password: an attacker who has
    // the password must not get unlimited attempts at the second factor.
    const outcome = await security.recordLoginAttempt({
      email: user.email,
      ipHash,
      succeeded: false,
      threshold: config.loginLockoutThreshold,
      lockMinutes: config.loginLockoutMinutes,
    });

    if (outcome.locked) {
      throw locked('account_locked', 'Too many failed attempts. This account is temporarily locked.');
    }

    throw unauthorized('invalid_code', 'That verification code is not valid.');
  }

  const membership = await accounts.findMembership(user.id, claims.act);
  if (!membership) throw forbidden('not_a_member', 'Account access has been removed.');

  await security.recordLoginAttempt({ email: user.email, ipHash, succeeded: true });
  await accounts.recordLogin(user.id);

  const session = await issueSession({
    user,
    accountId: membership.account_id,
    role: membership.role,
    userAgent,
    ipHash,
  });

  if (await recordSignIn({ userId: user.id, accountId: membership.account_id, userAgent, ipHash })) {
    notify.notifyNewDevice({ email: user.email, deviceLabel: describeDevice(userAgent) });
  }

  return {
    ...session,
    user: { id: user.id, email: user.email, fullName: user.full_name },
    role: membership.role,
    accountId: membership.account_id,
    usedRecoveryCode: result.method === 'recovery_code',
    remainingRecoveryCodes: result.remainingRecoveryCodes,
  };
}

// --------------------------------------------------------------- refresh ---

export async function refresh({ refreshToken, userAgent, ipHash }) {
  if (!refreshToken) throw unauthorized('invalid_refresh', 'No session token supplied.');

  const stored = await sessions.findRefreshToken(hashToken(refreshToken, config.jwtSecret));
  if (!stored) throw unauthorized('invalid_refresh', 'Session is no longer valid.');

  // A revoked token being presented means it leaked: the legitimate client
  // would be holding its replacement. Revoke the whole family.
  if (stored.revoked_at) {
    const revoked = await sessions.revokeUserTokens(stored.user_id);
    logger.warn('auth.refresh_reuse_detected', { userId: stored.user_id, revoked });

    const user = await accounts.findUserById(stored.user_id);
    if (user) notify.notifySessionsRevoked({ email: user.email, count: revoked });

    throw unauthorized('refresh_reused', 'Session was revoked for your security. Please sign in.');
  }

  if (new Date(stored.expires_at).getTime() < Date.now()) {
    throw unauthorized('refresh_expired', 'Session expired. Please sign in again.');
  }

  const user = await accounts.findUserById(stored.user_id);
  const membership = await accounts.findMembership(stored.user_id, stored.account_id);
  if (!user || !membership) throw unauthorized('invalid_refresh', 'Session is no longer valid.');

  const session = await issueSession({
    user,
    accountId: stored.account_id,
    role: membership.role,
    userAgent,
    ipHash,
    replacedTokenId: stored.id,
  });

  return { ...session, role: membership.role, accountId: stored.account_id };
}

/** Switch the active account without a full re-login. */
export async function switchAccount({ userId, accountId, userAgent, ipHash }) {
  const membership = await accounts.findMembership(userId, accountId);
  if (!membership) throw forbidden('not_a_member', 'You do not have access to that account.');

  const user = await accounts.findUserById(userId);
  const session = await issueSession({
    user,
    accountId,
    role: membership.role,
    userAgent,
    ipHash,
  });

  return { ...session, role: membership.role, accountId };
}

// ---------------------------------------------------------------- logout ---

export async function logout(refreshToken) {
  if (!refreshToken) return { revoked: 0 };

  const stored = await sessions.findRefreshToken(hashToken(refreshToken, config.jwtSecret));
  if (!stored || stored.revoked_at) return { revoked: 0 };

  await sessions.revokeSessionForUser(stored.user_id, stored.id);
  return { revoked: 1 };
}

export async function logoutEverywhere(userId) {
  // Bumping the version retires outstanding access tokens immediately;
  // revoking refresh tokens stops new ones being minted.
  await accounts.bumpTokenVersion(userId);
  const revoked = await sessions.revokeUserTokens(userId);

  const user = await accounts.findUserById(userId);
  if (user) notify.notifySessionsRevoked({ email: user.email, count: revoked });

  return { revoked };
}

export async function logoutOtherDevices({ userId, currentRefreshToken }) {
  const currentHash = currentRefreshToken
    ? hashToken(currentRefreshToken, config.jwtSecret)
    : null;

  const revoked = await sessions.revokeOtherSessions(userId, currentHash);

  if (revoked > 0) {
    const user = await accounts.findUserById(userId);
    if (user) notify.notifySessionsRevoked({ email: user.email, count: revoked });
  }

  return { revoked };
}

export function listSessions({ userId, currentRefreshToken }) {
  const currentHash = currentRefreshToken
    ? hashToken(currentRefreshToken, config.jwtSecret)
    : null;
  return sessions.listActiveSessions(userId, currentHash);
}

export async function revokeSession({ userId, sessionId }) {
  const revoked = await sessions.revokeSessionForUser(userId, sessionId);
  if (!revoked) throw notFound('session_not_found', 'That session was not found.');
  return { revoked: true };
}

// -------------------------------------------------------------- passwords --

export async function changePassword({ userId, currentPassword, newPassword, userAgent }) {
  const identity = await accounts.findUserById(userId);
  const user = identity ? await accounts.findUserByEmail(identity.email) : null;

  if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
    throw unauthorized('invalid_credentials', 'Current password is incorrect.');
  }

  await assertPasswordAcceptable(newPassword, { email: user.email });
  const { sessionsRevoked } = await accounts.updatePassword(userId, await hashPassword(newPassword));

  notify.notifyPasswordChanged({ email: user.email, deviceLabel: describeDevice(userAgent) });
  logger.info('auth.password_changed', { userId, sessionsRevoked });

  return { sessionsRevoked };
}

/** Applies the same policy as signup; the caller has already consumed the token. */
export async function resetPasswordWithToken({ userId, newPassword, userAgent }) {
  const user = await accounts.findUserById(userId);
  if (!user) throw unauthorized('invalid_token', 'This reset link is no longer valid.');

  await assertPasswordAcceptable(newPassword, { email: user.email });
  const { sessionsRevoked } = await accounts.updatePassword(userId, await hashPassword(newPassword));

  notify.notifyPasswordChanged({ email: user.email, deviceLabel: describeDevice(userAgent) });
  logger.info('auth.password_reset', { userId, sessionsRevoked });

  return { sessionsRevoked };
}

export { hashIp };
