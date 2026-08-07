import rateLimit from 'express-rate-limit';

import { logger } from '../../logger.js';
import { rateLimitCommand, rateLimitRedisReady } from '../../queue/index.js';
import { publicClientFingerprint } from '../../services/encryption.js';
import { ResilientRateLimitStore } from './resilientStore.js';

/**
 * Rate limiting.
 *
 * Redis-backed so limits hold across every instance. Authentication limiters
 * fail closed; everything else fails open. See resilientStore.js for why.
 */

function build({ prefix, windowMs, max, keyGenerator, message, code, failClosed = false }) {
  return rateLimit({
    windowMs,
    max,
    store: new ResilientRateLimitStore({
      prefix,
      failClosed,
      // Resolved per command so the connection is only created on first use,
      // and gated on connection status so a doomed command is never issued.
      sendCommand: (...args) => rateLimitCommand(...args),
      isAvailable: rateLimitRedisReady,
    }),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator,
    // Never limit preflight — a blocked OPTIONS breaks the entire browser app.
    skip: (req) => req.method === 'OPTIONS',
    handler: (req, res) => {
      logger.warn('ratelimit.tripped', { prefix, path: req.route?.path ?? req.path });
      res.status(429).json({ error: { code, message }, requestId: req.requestId });
    },
  });
}

/**
 * Normalise a client address into a rate-limit key.
 *
 * IPv6 must be grouped to its /64 prefix. A single residential IPv6 allocation
 * is typically a /64 or larger, so keying on the full address would hand one
 * attacker effectively unlimited distinct keys and make the limiter useless.
 * IPv4 is used whole.
 */
export function ipKey(ip) {
  const value = String(ip ?? '').trim();
  if (!value) return 'unknown';

  // Node reports IPv4 as ::ffff:a.b.c.d behind some proxies.
  const unmapped = value.replace(/^::ffff:/i, '');
  if (!unmapped.includes(':')) return unmapped;

  return `${unmapped.split(':').slice(0, 4).join(':')}::/64`;
}

/** Account when authenticated, source address otherwise. */
const byAccountOrIp = (req) => req.auth?.accountId ?? ipKey(req.ip);

/**
 * Login and registration.
 *
 * Keyed on IP *and* email, so one attacker cannot lock out a legitimate user
 * from elsewhere, and rotating addresses does not buy unlimited guesses at one
 * account. Database-backed account lockout is the second layer that catches
 * genuinely distributed attempts.
 */
export const authLimiter = build({
  prefix: 'auth',
  windowMs: 15 * 60 * 1000,
  max: 10,
  failClosed: true,
  code: 'too_many_attempts',
  message: 'Too many attempts. Try again in 15 minutes.',
  keyGenerator: (req) =>
    `${ipKey(req.ip)}:${String(req.body?.email ?? '').toLowerCase().slice(0, 120)}`,
});

export const refreshLimiter = build({
  prefix: 'refresh',
  windowMs: 60 * 1000,
  max: 30,
  failClosed: true,
  code: 'refresh_rate_limited',
  message: 'Too many session refreshes. Slow down.',
  keyGenerator: (req) => ipKey(req.ip),
});

/** Tighter than login: the password has already been proven. */
export const mfaLimiter = build({
  prefix: 'mfa',
  windowMs: 15 * 60 * 1000,
  max: 8,
  failClosed: true,
  code: 'mfa_rate_limited',
  message: 'Too many verification attempts. Try again in 15 minutes.',
  keyGenerator: (req) => `${ipKey(req.ip)}:${req.auth?.userId ?? 'anon'}`,
});

export const apiLimiter = build({
  prefix: 'api',
  windowMs: 60 * 1000,
  max: 300,
  code: 'rate_limited',
  message: 'Too many requests. Slow down.',
  keyGenerator: byAccountOrIp,
});

export const campaignLimiter = build({
  prefix: 'campaign',
  windowMs: 60 * 1000,
  max: 10,
  code: 'campaign_rate_limited',
  message: 'Too many campaigns created. Wait a minute.',
  keyGenerator: byAccountOrIp,
});

export const writeLimiter = build({
  prefix: 'write',
  windowMs: 60 * 1000,
  max: 60,
  code: 'write_rate_limited',
  message: 'Too many changes at once. Wait a moment.',
  keyGenerator: byAccountOrIp,
});

/** QR rendering is CPU-bound, so it gets its own tighter budget. */
export const renderLimiter = build({
  prefix: 'render',
  windowMs: 60 * 1000,
  max: 30,
  code: 'render_rate_limited',
  message: 'Too many QR downloads. Wait a moment.',
  keyGenerator: byAccountOrIp,
});

/** Billing calls hit Stripe, which has its own limits we must stay under. */
export const billingLimiter = build({
  prefix: 'billing',
  windowMs: 60 * 1000,
  max: 20,
  code: 'billing_rate_limited',
  message: 'Too many billing requests. Wait a moment.',
  keyGenerator: byAccountOrIp,
});

/**
 * The anonymous customer flow.
 *
 * Layered deliberately, because neither layer alone works:
 *
 *   Per stand — a whole restaurant shares one NAT address, so an address-keyed
 *   limit would block real customers at exactly the busiest moment. This is the
 *   layer that bounds abuse of one printed code.
 *
 *   Per client fingerprint — a rotating keyed hash of address and user agent,
 *   never the raw address. This is the layer that stops one device from filling
 *   a business's feedback with fabricated submissions while every other
 *   customer at that stand carries on unaffected.
 *
 * Reads get a generous budget; writes get a tight one.
 */
const byStand = (req) => `stand:${req.params?.token ?? ipKey(req.ip)}`;

export const publicContextLimiter = build({
  prefix: 'public-context',
  windowMs: 60 * 1000,
  max: 240,
  code: 'rate_limited',
  message: 'This review link is receiving too many requests. Try again shortly.',
  keyGenerator: byStand,
});

export const publicStandWriteLimiter = build({
  prefix: 'public-write-stand',
  windowMs: 60 * 1000,
  max: 60,
  code: 'rate_limited',
  message: 'This review link is receiving too many submissions. Try again shortly.',
  keyGenerator: byStand,
});

export const publicClientWriteLimiter = build({
  prefix: 'public-write-client',
  windowMs: 5 * 60 * 1000,
  max: 30,
  code: 'rate_limited',
  message: 'Too many submissions from this device. Try again shortly.',
  // Hashed, so no raw address is stored even in the limiter's own state.
  keyGenerator: (req) =>
    publicClientFingerprint({ ip: ipKey(req.ip), userAgent: req.get('user-agent') }),
});

/** Generous, because Stripe and Twilio legitimately burst — but not unbounded. */
export const webhookLimiter = build({
  prefix: 'webhook',
  windowMs: 60 * 1000,
  max: 600,
  code: 'webhook_rate_limited',
  message: 'Too many webhook deliveries.',
  keyGenerator: (req) => ipKey(req.ip),
});
