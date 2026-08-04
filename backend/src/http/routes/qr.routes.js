import { Router } from 'express';

import * as audit from '../../repositories/auditRepository.js';
import * as qrRepo from '../../repositories/qrRepository.js';
import * as qr from '../../services/qrService.js';
import { notFound } from '../errors.js';
import { enforceIpAllowlist, requireAuth, requireRole } from '../middleware/auth.js';
import { asyncRoute, validate } from '../middleware/core.js';
import { renderLimiter, writeLimiter } from '../middleware/rateLimit.js';
import {
  analyticsRangeSchema,
  createStandSchema,
  paginationSchema,
  qrSizeSchema,
  updateStandSchema,
  uuidParamSchema,
} from '../schemas.js';

export const qrRoutes = Router();

qrRoutes.use(requireAuth);
qrRoutes.use(enforceIpAllowlist);

// ------------------------------------------------------------- stands -----

qrRoutes.get(
  '/stands',
  asyncRoute(async (req, res) => {
    res.json({ stands: await qr.listStands(req.auth.accountId) });
  }),
);

qrRoutes.post(
  '/stands',
  requireRole('member'),
  writeLimiter,
  validate(createStandSchema),
  asyncRoute(async (req, res) => {
    const stand = await qr.createStand(req.auth.accountId, req.body);

    await audit.record({
      accountId: req.auth.accountId,
      actorUserId: req.auth.userId,
      action: 'qr.stand_created',
      targetType: 'qr_stand',
      targetId: stand.id,
    });

    res.status(201).json({ stand });
  }),
);

qrRoutes.patch(
  '/stands/:standId',
  requireRole('member'),
  writeLimiter,
  validate(uuidParamSchema('standId'), 'params'),
  validate(updateStandSchema),
  asyncRoute(async (req, res) => {
    res.json({ stand: await qr.updateStand(req.auth.accountId, req.params.standId, req.body) });
  }),
);

qrRoutes.delete(
  '/stands/:standId',
  requireRole('admin'),
  validate(uuidParamSchema('standId'), 'params'),
  asyncRoute(async (req, res) => {
    await qr.deleteStand(req.auth.accountId, req.params.standId);

    await audit.record({
      accountId: req.auth.accountId,
      actorUserId: req.auth.userId,
      action: 'qr.stand_deleted',
      targetType: 'qr_stand',
      targetId: req.params.standId,
    });

    res.status(204).end();
  }),
);

// ------------------------------------------------------------ exports -----

qrRoutes.get(
  '/stands/:standId/qr.png',
  renderLimiter,
  validate(uuidParamSchema('standId'), 'params'),
  validate(qrSizeSchema, 'query'),
  asyncRoute(async (req, res) => {
    const dataUrl = await qr.renderPng(req.auth.accountId, req.params.standId, {
      size: req.validatedQuery.size,
    });

    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'private, max-age=300');
    res.send(Buffer.from(dataUrl.split(',')[1], 'base64'));
  }),
);

qrRoutes.get(
  '/stands/:standId/qr.svg',
  renderLimiter,
  validate(uuidParamSchema('standId'), 'params'),
  asyncRoute(async (req, res) => {
    const svg = await qr.renderSvg(req.auth.accountId, req.params.standId);

    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'private, max-age=300');
    res.send(svg);
  }),
);

// ----------------------------------------------------------- analytics ----

qrRoutes.get(
  '/analytics',
  validate(analyticsRangeSchema, 'query'),
  asyncRoute(async (req, res) => {
    res.json(await qrRepo.scanAnalytics(req.auth.accountId, req.validatedQuery.days));
  }),
);

qrRoutes.get(
  '/feedback',
  validate(paginationSchema, 'query'),
  asyncRoute(async (req, res) => {
    res.json(await qr.listFeedback(req.auth.accountId, req.validatedQuery));
  }),
);

qrRoutes.post(
  '/feedback/:feedbackId/resolve',
  requireRole('member'),
  validate(uuidParamSchema('feedbackId'), 'params'),
  asyncRoute(async (req, res) => {
    const resolved = await qrRepo.resolveFeedback(req.auth.accountId, req.params.feedbackId);
    if (!resolved) throw notFound('feedback_not_found', 'Feedback not found.');
    res.json({ feedback: resolved });
  }),
);
