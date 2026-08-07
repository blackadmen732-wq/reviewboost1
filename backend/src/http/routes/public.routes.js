import { Router } from 'express';

import { config } from '../../config/index.js';
import { AppError } from '../errors.js';
import { validate } from '../middleware/core.js';
import { publicContextLimiter } from '../middleware/rateLimit.js';
import { publicIdSchema } from '../schemas.js';

/**
 * Compatibility for stands printed before the customer flow moved.
 *
 * What used to live here was a server-rendered rating gate: it sent 4- and
 * 5-star selections straight to Google and diverted everything below a
 * per-stand threshold into a private form that demanded an explanation and
 * offered to collect a phone number and email address. That is review gating,
 * it is prohibited, and it is gone. Nothing in this file reads
 * `review_threshold`, and there is no path back to it.
 *
 * These two routes remain only because a QR code on a physical table tent
 * cannot be recalled. A code printed against the old origin still works: the
 * customer is sent to the current flow instead of a dead page.
 */
export const publicRoutes = Router();

/**
 * Send a legacy scan to the current customer flow.
 *
 * The destination is built from validated configuration, never from anything in
 * the request, so this cannot be turned into an open redirect. The token is
 * encoded, and has already been checked against a strict character class.
 */
publicRoutes.get(
  '/q/:publicId',
  publicContextLimiter,
  validate(publicIdSchema, 'params'),
  (req, res) => {
    const destination = `${config.publicFrontendUrl}/q/${encodeURIComponent(req.params.publicId)}`;

    res.set('Cache-Control', 'no-store');
    // 302 rather than 301: the mapping is a deployment detail, and a permanent
    // redirect would be cached in customers' browsers indefinitely.
    res.redirect(302, destination);
  },
);

/**
 * The rating-gating endpoint, explicitly removed.
 *
 * 410 rather than a silent 404, so anything still calling it — an old cached
 * page, a partially-updated deployment — reports a clear cause instead of
 * looking like a routing mistake.
 */
publicRoutes.post('/q/:publicId/rating', (_req, _res, next) => {
  next(
    new AppError(
      410,
      'endpoint_removed',
      'This endpoint has been removed. Use POST /api/v1/public/q/{token}/responses.',
    ),
  );
});
