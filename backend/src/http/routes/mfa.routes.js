import { Router } from 'express';

import * as audit from '../../repositories/auditRepository.js';
import * as mfa from '../../services/mfaService.js';
import { notifyMfaChanged } from '../../services/securityNotifications.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncRoute, validate } from '../middleware/core.js';
import { mfaLimiter } from '../middleware/rateLimit.js';
import { mfaCodeSchema } from '../schemas.js';

export const mfaRoutes = Router();

mfaRoutes.use(requireAuth);

/**
 * Two-factor authentication.
 *
 * Enrolment is two-step by design: a secret is issued, and MFA only activates
 * once the user proves they can produce a valid code from it. A one-step flow
 * locks people out of their own accounts when setup goes wrong, and the support
 * burden of that pushes teams toward unsafe recovery paths.
 */

mfaRoutes.get(
  '/',
  asyncRoute(async (req, res) => {
    const record = await mfa.getMfa(req.auth.userId);
    res.json({
      enabled: Boolean(record?.confirmed_at),
      enrolmentStarted: Boolean(record) && !record.confirmed_at,
      recoveryCodesRemaining: record?.recovery_code_hashes?.length ?? 0,
    });
  }),
);

/** Step 1 — issue a secret. Returns the otpauth:// URI for a QR code. */
mfaRoutes.post(
  '/setup',
  mfaLimiter,
  asyncRoute(async (req, res) => {
    const { secret, otpauthUrl } = await mfa.beginEnrolment({
      userId: req.auth.userId,
      email: req.auth.email,
    });

    res.json({
      otpauthUrl,
      // For manual entry when a camera is unavailable. Shown once.
      manualEntryKey: secret,
      message: 'Scan this with your authenticator app, then confirm with a code.',
    });
  }),
);

/** Step 2 — confirm and activate. Recovery codes are shown exactly once. */
mfaRoutes.post(
  '/confirm',
  mfaLimiter,
  validate(mfaCodeSchema),
  asyncRoute(async (req, res) => {
    const { recoveryCodes } = await mfa.confirmEnrolment({
      userId: req.auth.userId,
      email: req.auth.email,
      code: req.body.code,
    });

    notifyMfaChanged({ email: req.auth.email, enabled: true });
    await audit.record({
      accountId: req.auth.accountId,
      actorUserId: req.auth.userId,
      action: 'mfa.enabled',
    });

    res.json({
      enabled: true,
      recoveryCodes,
      message:
        'Save these recovery codes somewhere safe. Each works once, and they are the only ' +
        'way in if you lose your authenticator.',
    });
  }),
);

/** Requires a valid code, so a hijacked session cannot switch it off. */
mfaRoutes.post(
  '/disable',
  mfaLimiter,
  validate(mfaCodeSchema),
  asyncRoute(async (req, res) => {
    await mfa.disable({ userId: req.auth.userId, email: req.auth.email, code: req.body.code });

    notifyMfaChanged({ email: req.auth.email, enabled: false });
    await audit.record({
      accountId: req.auth.accountId,
      actorUserId: req.auth.userId,
      action: 'mfa.disabled',
    });

    res.json({ enabled: false });
  }),
);

mfaRoutes.post(
  '/recovery-codes',
  mfaLimiter,
  validate(mfaCodeSchema),
  asyncRoute(async (req, res) => {
    const { recoveryCodes } = await mfa.regenerateRecoveryCodes({
      userId: req.auth.userId,
      email: req.auth.email,
      code: req.body.code,
    });

    await audit.record({
      accountId: req.auth.accountId,
      actorUserId: req.auth.userId,
      action: 'mfa.recovery_codes_regenerated',
    });

    res.json({ recoveryCodes, message: 'Your previous recovery codes no longer work.' });
  }),
);
