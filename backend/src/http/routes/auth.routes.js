import { Router } from 'express';

import { config } from '../../config/index.js';
import * as accounts from '../../repositories/accountRepository.js';
import * as audit from '../../repositories/auditRepository.js';
import * as security from '../../repositories/securityRepository.js';
import * as auth from '../../services/authService.js';
import * as email from '../../services/emailService.js';
import { hashIp } from '../../services/encryption.js';
import { badRequest } from '../errors.js';
import { ACCESS_COOKIE, REFRESH_COOKIE, cookieOptions, requireAuth } from '../middleware/auth.js';
import { asyncRoute, validate } from '../middleware/core.js';
import { issueCsrfToken } from '../middleware/csrf.js';
import { authLimiter, refreshLimiter } from '../middleware/rateLimit.js';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaChallengeSchema,
  paginationSchema,
  registerSchema,
  resetPasswordSchema,
  switchAccountSchema,
  uuidParamSchema,
  verifyEmailSchema,
} from '../schemas.js';

export const authRoutes = Router();

function setSessionCookies(res, session) {
  res.cookie(ACCESS_COOKIE, session.accessToken, cookieOptions(config.accessTokenTtlSeconds * 1000));
  res.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions(config.refreshTokenTtlDays * 86_400_000));
  // Rotated alongside the session so it can never outlive it.
  return issueCsrfToken(res);
}

function clearSessionCookies(res) {
  // clearCookie must receive the same attributes the cookie was set with, or
  // the browser keeps it.
  const base = { ...cookieOptions(0) };
  delete base.maxAge;
  res.clearCookie(ACCESS_COOKIE, base);
  res.clearCookie(REFRESH_COOKIE, base);
}

authRoutes.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  asyncRoute(async (req, res) => {
    const session = await auth.register({
      ...req.body,
      userAgent: req.get('user-agent'),
      ipHash: hashIp(req.ip),
    });

    await email.sendVerificationEmail({ ...session.user, email: req.body.email });
    await audit.record({
      accountId: session.account.id,
      actorUserId: session.user.id,
      action: 'account.registered',
      targetType: 'account',
      targetId: session.account.id,
      ipHash: hashIp(req.ip),
    });

    const csrfToken = setSessionCookies(res, session);

    res.status(201).json({
      csrfToken,
      account: session.account,
      user: { id: session.user.id, email: session.user.email },
      role: session.role,
      // Also in the body so native clients need not read cookies.
      accessToken: session.accessToken,
      expiresIn: config.accessTokenTtlSeconds,
    });
  }),
);

authRoutes.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  asyncRoute(async (req, res) => {
    const session = await auth.login({
      ...req.body,
      userAgent: req.get('user-agent'),
      ipHash: hashIp(req.ip),
    });

    // Password accepted, second factor still required. No cookie is set and no
    // access token is issued until the challenge is answered.
    if (session.mfaRequired) {
      return res.json({
        mfaRequired: true,
        challengeToken: session.challengeToken,
        message: 'Enter the code from your authenticator app.',
      });
    }

    const csrfToken = setSessionCookies(res, session);

    return res.json({
      csrfToken,
      user: session.user,
      role: session.role,
      accountId: session.accountId,
      memberships: session.memberships.map((membership) => ({
        accountId: membership.account_id,
        businessName: membership.business_name,
        role: membership.role,
      })),
      accessToken: session.accessToken,
      expiresIn: config.accessTokenTtlSeconds,
    });
  }),
);

/** Second step of a two-factor sign-in. */
authRoutes.post(
  '/mfa/challenge',
  authLimiter,
  validate(mfaChallengeSchema),
  asyncRoute(async (req, res) => {
    const session = await auth.completeMfaChallenge({
      ...req.body,
      userAgent: req.get('user-agent'),
      ipHash: hashIp(req.ip),
    });

    const csrfToken = setSessionCookies(res, session);

    res.json({
      csrfToken,
      user: session.user,
      role: session.role,
      accountId: session.accountId,
      accessToken: session.accessToken,
      expiresIn: config.accessTokenTtlSeconds,
      // Warn when a recovery code was burned, so they can regenerate.
      ...(session.usedRecoveryCode
        ? { usedRecoveryCode: true, remainingRecoveryCodes: session.remainingRecoveryCodes }
        : {}),
    });
  }),
);

authRoutes.post(
  '/refresh',
  refreshLimiter,
  asyncRoute(async (req, res) => {
    const session = await auth.refresh({
      refreshToken: req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken,
      userAgent: req.get('user-agent'),
      ipHash: hashIp(req.ip),
    });

    const csrfToken = setSessionCookies(res, session);

    res.json({
      csrfToken,
      accessToken: session.accessToken,
      role: session.role,
      accountId: session.accountId,
      expiresIn: config.accessTokenTtlSeconds,
    });
  }),
);

authRoutes.post(
  '/logout',
  asyncRoute(async (req, res) => {
    await auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearSessionCookies(res);
    res.json({ ok: true });
  }),
);

authRoutes.post(
  '/logout-all',
  requireAuth,
  asyncRoute(async (req, res) => {
    const { revoked } = await auth.logoutEverywhere(req.auth.userId);
    clearSessionCookies(res);
    res.json({ ok: true, sessionsRevoked: revoked });
  }),
);

authRoutes.get(
  '/session',
  requireAuth,
  asyncRoute(async (req, res) => {
    const memberships = await accounts.listMembershipsForUser(req.auth.userId);
    res.json({
      user: {
        id: req.auth.userId,
        email: req.auth.email,
        emailVerified: Boolean(req.auth.emailVerifiedAt),
      },
      account: req.auth.account,
      role: req.auth.role,
      subscription: req.auth.subscription,
      memberships: memberships.map((membership) => ({
        accountId: membership.account_id,
        businessName: membership.business_name,
        role: membership.role,
      })),
    });
  }),
);

authRoutes.post(
  '/switch-account',
  requireAuth,
  validate(switchAccountSchema),
  asyncRoute(async (req, res) => {
    const session = await auth.switchAccount({
      userId: req.auth.userId,
      accountId: req.body.accountId,
      userAgent: req.get('user-agent'),
      ipHash: hashIp(req.ip),
    });

    const csrfToken = setSessionCookies(res, session);
    res.json({
      csrfToken,
      accessToken: session.accessToken,
      accountId: session.accountId,
      role: session.role,
    });
  }),
);

// ------------------------------------------------------------- passwords ---

authRoutes.post(
  '/change-password',
  requireAuth,
  authLimiter,
  validate(changePasswordSchema),
  asyncRoute(async (req, res) => {
    const { sessionsRevoked } = await auth.changePassword({
      userId: req.auth.userId,
      ...req.body,
      userAgent: req.get('user-agent'),
    });

    await audit.record({
      accountId: req.auth.accountId,
      actorUserId: req.auth.userId,
      action: 'user.password_changed',
      ipHash: hashIp(req.ip),
    });

    clearSessionCookies(res);
    res.json({ ok: true, sessionsRevoked, message: 'Password changed. Please sign in again.' });
  }),
);

/**
 * Always responds 202, whether or not the address exists.
 *
 * Anything else turns this endpoint into an oracle for enumerating which
 * emails have ReviewBoost accounts.
 */
authRoutes.post(
  '/forgot-password',
  authLimiter,
  validate(forgotPasswordSchema),
  asyncRoute(async (req, res) => {
    const user = await accounts.findUserByEmail(req.body.email);
    if (user) await email.sendPasswordResetEmail(user);

    res.status(202).json({
      ok: true,
      message: 'If that email has an account, a reset link is on its way.',
    });
  }),
);

authRoutes.post(
  '/reset-password',
  authLimiter,
  validate(resetPasswordSchema),
  asyncRoute(async (req, res) => {
    const userId = await email.consumeUserToken(req.body.token, 'password_reset');
    if (!userId) throw badRequest('invalid_token', 'This reset link is invalid or has expired.');

    // Applies the same policy as signup, and revokes every existing session —
    // which is the entire point of a reset.
    const { sessionsRevoked } = await auth.resetPasswordWithToken({
      userId,
      newPassword: req.body.newPassword,
      userAgent: req.get('user-agent'),
    });

    res.json({ ok: true, sessionsRevoked, message: 'Password reset. Please sign in.' });
  }),
);

authRoutes.post(
  '/verify-email',
  validate(verifyEmailSchema),
  asyncRoute(async (req, res) => {
    const userId = await email.consumeUserToken(req.body.token, 'email_verification');
    if (!userId) {
      throw badRequest('invalid_token', 'This verification link is invalid or has expired.');
    }

    await accounts.markEmailVerified(userId);
    res.json({ ok: true, verified: true });
  }),
);

// -------------------------------------------------------------- sessions ---

authRoutes.get(
  '/sessions',
  requireAuth,
  asyncRoute(async (req, res) => {
    const rows = await auth.listSessions({
      userId: req.auth.userId,
      currentRefreshToken: req.cookies?.[REFRESH_COOKIE],
    });

    res.json({
      sessions: rows.map((row) => ({
        id: row.id,
        device: row.device_label ?? 'Unknown device',
        location: row.approximate_location ?? 'Unknown location',
        isCurrent: row.is_current === true,
        signedInAt: row.created_at,
        lastActiveAt: row.last_used_at,
        expiresAt: row.expires_at,
      })),
    });
  }),
);

authRoutes.delete(
  '/sessions/:sessionId',
  requireAuth,
  validate(uuidParamSchema('sessionId'), 'params'),
  asyncRoute(async (req, res) => {
    await auth.revokeSession({ userId: req.auth.userId, sessionId: req.params.sessionId });

    await audit.record({
      accountId: req.auth.accountId,
      actorUserId: req.auth.userId,
      action: 'session.revoked',
      targetType: 'session',
      targetId: req.params.sessionId,
    });

    res.status(204).end();
  }),
);

/** Sign out everywhere else, keeping the caller signed in. */
authRoutes.post(
  '/sessions/revoke-others',
  requireAuth,
  asyncRoute(async (req, res) => {
    const { revoked } = await auth.logoutOtherDevices({
      userId: req.auth.userId,
      currentRefreshToken: req.cookies?.[REFRESH_COOKIE],
    });

    await audit.record({
      accountId: req.auth.accountId,
      actorUserId: req.auth.userId,
      action: 'session.revoked_others',
      metadata: { revoked },
    });

    res.json({ ok: true, sessionsRevoked: revoked });
  }),
);

/** Sign-in history: which devices, from where, and when. */
authRoutes.get(
  '/activity',
  requireAuth,
  validate(paginationSchema, 'query'),
  asyncRoute(async (req, res) => {
    const events = await security.listSecurityEvents(req.auth.userId, req.validatedQuery);

    res.json({
      activity: events.map((event) => ({
        type: event.event_type,
        device: event.device_label ?? 'Unknown device',
        location: event.approximate_location ?? 'Unknown location',
        succeeded: event.succeeded,
        at: event.created_at,
      })),
    });
  }),
);
