import { Router } from 'express';

import * as flow from '../../services/customerFlowService.js';
import { asyncRoute, validate } from '../middleware/core.js';
import { requireIdempotencyKey } from '../middleware/idempotency.js';
import {
  publicClientWriteLimiter,
  publicContextLimiter,
  publicStandWriteLimiter,
} from '../middleware/rateLimit.js';
import {
  createSessionSchema,
  googleClickSchema,
  publicTokenSchema,
  submitResponseSchema,
  teamPraiseSchema,
} from '../schemas.js';

/**
 * The anonymous customer flow: /api/v1/public/q/:token
 *
 * Uncredentialed by design. The stand token in the URL is an anonymous
 * capability: it authorises submitting feedback to exactly one business and
 * nothing else. There is no session cookie, no CSRF token, and no Authorization
 * header on this path — see middleware/csrf.js for why requiring one would
 * break an owner who scans their own code while signed in to the dashboard.
 *
 * REVIEW INTEGRITY
 * ----------------
 * Every rating from 1 to 5 takes the identical path through these five routes,
 * and the Google opportunity in the context response is the same for all of
 * them. There is no threshold, no rating-dependent branch, and no redirect. The
 * private note and Team Praise are additive steps a customer may take, never a
 * substitute for the public review.
 *
 * WHAT NEVER CROSSES THE WIRE
 * ---------------------------
 * No account id, no stand id, no session or response database id, no
 * subscription state. An anonymous caller that learned the tenant could write
 * unlimited fabricated feedback into it, so the tenant is derived server-side
 * from the token on every request and never returned.
 *
 * Success responses are the raw DTOs the published contract defines — no
 * envelope. Failures are `{ error: { code, message, details? }, requestId }`.
 */
export const customerFlowRoutes = Router();

/** These responses are per-customer and must not sit in any shared cache. */
function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

customerFlowRoutes.use(noStore);

const writeLimiters = [publicStandWriteLimiter, publicClientWriteLimiter];

/**
 * Public presentation.
 *
 * Read-only: a GET never records a scan, so a link preview, a crawler, or an
 * owner refreshing the page cannot inflate a business's numbers. The scan is
 * recorded when a session is created.
 */
customerFlowRoutes.get(
  '/q/:token',
  publicContextLimiter,
  validate(publicTokenSchema, 'params'),
  asyncRoute(async (req, res) => {
    res.json(await flow.getContext(req.params.token));
  }),
);

/** Start a session. 201 when created, 200 when an identical request is replayed. */
customerFlowRoutes.post(
  '/q/:token/sessions',
  ...writeLimiters,
  validate(publicTokenSchema, 'params'),
  requireIdempotencyKey,
  validate(createSessionSchema),
  asyncRoute(async (req, res) => {
    const result = await flow.createSession(req.params.token, {
      locale: req.body.locale,
      idempotencyKey: req.idempotencyKey,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      route: '/api/v1/public/q/:token/sessions',
      method: req.method,
    });

    res.status(result.status).json(result.body);
  }),
);

/**
 * Store the rating and optional private note.
 *
 * Identical handling for every rating. The note is optional for all five, and
 * nothing about the response varies with the value chosen.
 */
customerFlowRoutes.post(
  '/q/:token/responses',
  ...writeLimiters,
  validate(publicTokenSchema, 'params'),
  requireIdempotencyKey,
  validate(submitResponseSchema),
  asyncRoute(async (req, res) => {
    const result = await flow.submitResponse(req.params.token, {
      sessionId: req.body.sessionId,
      rating: req.body.rating,
      note: req.body.note,
      idempotencyKey: req.idempotencyKey,
      route: '/api/v1/public/q/:token/responses',
      method: req.method,
    });

    res.status(result.status).json(result.body);
  }),
);

/**
 * Record that the Google action was selected.
 *
 * Records the selection and nothing more. It does not mean a review was
 * written, submitted, or published, and it never redirects — the client owns
 * the navigation, so a tracking failure can never stand between a customer and
 * the public review page.
 */
customerFlowRoutes.post(
  '/q/:token/google-click',
  ...writeLimiters,
  validate(publicTokenSchema, 'params'),
  requireIdempotencyKey,
  validate(googleClickSchema),
  asyncRoute(async (req, res) => {
    await flow.recordGoogleClick(req.params.token, {
      sessionId: req.body.sessionId,
      responseId: req.body.responseId,
      idempotencyKey: req.idempotencyKey,
      route: '/api/v1/public/q/:token/google-click',
      method: req.method,
    });

    // 204 on a first record and on a replay alike: the contract documents one
    // success status for this operation.
    res.status(204).end();
  }),
);

/**
 * Store praise for a colleague.
 *
 * Never returns the rating, the Google state, or anything else about the
 * response it is attached to. Praise is stored unmatched — ReviewBoost does not
 * guess which employee the customer meant.
 */
customerFlowRoutes.post(
  '/q/:token/team-praise',
  ...writeLimiters,
  validate(publicTokenSchema, 'params'),
  requireIdempotencyKey,
  validate(teamPraiseSchema),
  asyncRoute(async (req, res) => {
    const result = await flow.submitTeamPraise(req.params.token, {
      sessionId: req.body.sessionId,
      responseId: req.body.responseId,
      firstName: req.body.firstName,
      note: req.body.note,
      idempotencyKey: req.idempotencyKey,
      route: '/api/v1/public/q/:token/team-praise',
      method: req.method,
    });

    res.status(result.status).json(result.body);
  }),
);
