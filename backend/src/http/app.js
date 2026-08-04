import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { config } from '../config/index.js';
import { migrationStatus } from '../db/migrate.js';
import { checkDatabase, poolStats } from '../db/pool.js';
import { queueDepths } from '../queue/index.js';
import {
  accessLog,
  errorHandler,
  notFoundHandler,
  requestId,
  requestTimeout,
} from './middleware/core.js';
import { csrfTokenRoute, requireCsrfToken } from './middleware/csrf.js';
import { apiLimiter, webhookLimiter } from './middleware/rateLimit.js';
import { authRoutes } from './routes/auth.routes.js';
import { campaignRoutes } from './routes/campaigns.routes.js';
import { dashboardRoutes } from './routes/dashboard.routes.js';
import { mfaRoutes } from './routes/mfa.routes.js';
import { publicRoutes } from './routes/public.routes.js';
import { qrRoutes } from './routes/qr.routes.js';
import { webhookRoutes } from './routes/webhooks.routes.js';

export function createApp() {
  const app = express();

  // Behind a load balancer or TLS-terminating proxy, req.ip and req.protocol
  // are wrong without this. IP-keyed rate limiting, the IP allowlist, and
  // webhook URL reconstruction all depend on it being correct.
  app.set('trust proxy', config.isProduction ? 1 : false);
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use(requestId);
  app.use(accessLog);
  // Bounds every request, so a wedged handler cannot hold a socket and a
  // connection-pool slot indefinitely.
  app.use(requestTimeout());

  app.use(
    helmet({
      // A JSON API plus one self-contained HTML gate page. The gate needs a
      // small inline script; everything else is JSON, so the exposure is
      // limited to that one route.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: config.isProduction
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header means same-origin or a non-browser client.
        if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
        return callback(null, false);
      },
      // Required for the httpOnly session cookies to cross origins.
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-CSRF-Token'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );

  app.use(compression());
  app.use(cookieParser());
  // Before any state-changing route. Exempts Bearer callers and requests
  // carrying no session cookie, so native clients are unaffected.
  app.use(requireCsrfToken);

  // Webhooks mount BEFORE the JSON parser: Stripe signature verification needs
  // the raw bytes, and Twilio posts form-encoded.
  app.use('/api/webhooks', webhookLimiter, webhookRoutes);

  app.use(express.json({ limit: '2mb' }));

  // ---- health ------------------------------------------------------------
  // Liveness stays trivial, so an unhealthy dependency never causes the
  // orchestrator to kill an otherwise working process.
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'reviewboost-api',
      mode: config.smsDryRun ? 'dry-run' : 'live',
    });
  });

  // Readiness reports dependencies and fails when they are down, so a rolling
  // deploy does not send traffic to an instance that cannot serve it.
  app.get('/api/ready', async (req, res) => {
    const checks = { database: false, redis: false, migrations: false };

    try {
      checks.database = await checkDatabase();
      checks.migrations = (await migrationStatus()).pending.length === 0;
    } catch {
      /* reported false below */
    }

    try {
      await queueDepths();
      checks.redis = true;
    } catch {
      /* reported false below */
    }

    const ready = Object.values(checks).every(Boolean);
    res.status(ready ? 200 : 503).json({
      ready,
      checks,
      pool: poolStats(),
      requestId: req.requestId,
    });
  });

  // Browsers fetch a token here before their first mutating request.
  app.get('/api/csrf-token', csrfTokenRoute);

  // ---- public QR gate (no auth) ------------------------------------------
  app.use('/', publicRoutes);

  // ---- API ---------------------------------------------------------------
  // MFA mounts before /api/auth, which would otherwise shadow these paths.
  app.use('/api/auth/mfa', apiLimiter, mfaRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/campaigns', apiLimiter, campaignRoutes);
  app.use('/api/qr', apiLimiter, qrRoutes);
  app.use('/api/dashboard', apiLimiter, dashboardRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
