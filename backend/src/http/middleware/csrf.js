import { config } from '../../config/index.js';
import { randomToken, secureCompare } from '../../domain/crypto.js';
import { forbidden } from '../errors.js';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './auth.js';

/**
 * CSRF protection using the double-submit cookie pattern.
 *
 * Cookie authentication means the browser attaches credentials automatically —
 * including on requests another site triggered. SameSite=Lax blocks most of
 * that, but it stops being sufficient the moment the frontend moves to its own
 * domain and the cookie has to become SameSite=None.
 *
 * The defence: a random token in a *readable* cookie, which the client must
 * echo in a header. A cross-origin attacker can cause the cookie to be sent but
 * cannot read it, so cannot produce the matching header.
 *
 * Bearer callers are exempt — an Authorization header is never attached
 * automatically by a browser, so there is nothing to forge.
 */

export const CSRF_COOKIE = 'rb_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfCookieOptions() {
  return {
    // Deliberately readable by JavaScript: the client has to echo it back.
    httpOnly: false,
    secure: config.isProduction,
    sameSite: config.isProduction ? 'none' : 'lax',
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
    ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
  };
}

export function issueCsrfToken(res) {
  const token = randomToken(24);
  res.cookie(CSRF_COOKIE, token, csrfCookieOptions());
  return token;
}

export function csrfTokenRoute(_req, res) {
  res.json({ csrfToken: issueCsrfToken(res) });
}

export function requireCsrfToken(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  // Not a browser, so not forgeable.
  if (String(req.get('authorization') ?? '').startsWith('Bearer ')) return next();

  // No session cookie means the request carries no ambient authority, so there
  // is nothing for an attacker to ride on.
  const hasSessionCookie = Boolean(req.cookies?.[ACCESS_COOKIE] || req.cookies?.[REFRESH_COOKIE]);
  if (!hasSessionCookie) return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);

  if (!cookieToken || !headerToken || !secureCompare(cookieToken, headerToken)) {
    return next(
      forbidden('csrf_failed', 'Missing or invalid CSRF token. Reload the page and try again.'),
    );
  }

  return next();
}
