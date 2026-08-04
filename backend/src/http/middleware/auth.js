import { config } from '../../config/index.js';
import { logger } from '../../logger.js';
import * as accounts from '../../repositories/accountRepository.js';
import * as audit from '../../repositories/auditRepository.js';
import * as billing from '../../repositories/billingRepository.js';
import { verifyAccessToken } from '../../services/authService.js';
import { isSubscriptionActive } from '../../services/billingService.js';
import { forbidden, paymentRequired, unauthorized } from '../errors.js';

export const ACCESS_COOKIE = 'rb_access';
export const REFRESH_COOKIE = 'rb_refresh';

/**
 * Session cookie attributes.
 *
 * SameSite=Lax works when the API and app share a site. A separately hosted
 * frontend needs SameSite=None, which browsers only accept together with
 * Secure — hence the pairing rather than two independent switches.
 */
export function cookieOptions(maxAgeMs, { crossSite = config.isProduction } = {}) {
  return {
    httpOnly: true,
    secure: config.isProduction || crossSite,
    sameSite: crossSite ? 'none' : 'lax',
    maxAge: maxAgeMs,
    path: '/',
    ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
  };
}

function bearerFrom(req) {
  const header = String(req.get('authorization') ?? '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/**
 * Establish identity.
 *
 * Accepts a Bearer token (native clients) or the httpOnly access cookie
 * (browsers). Two checks happen on *every* request rather than being trusted
 * from the token:
 *
 *   token_version — retires every access token issued before a password change
 *   or a logout-everywhere, without waiting up to 15 minutes for expiry.
 *
 *   membership — a member removed from an account loses access on their next
 *   call, not at token expiry.
 */
export async function requireAuth(req, _res, next) {
  try {
    const token = bearerFrom(req) || req.cookies?.[ACCESS_COOKIE];
    if (!token) throw unauthorized();

    const claims = verifyAccessToken(token);
    if (!claims?.sub || !claims?.act) throw unauthorized('invalid_token', 'Session is not valid.');

    const user = await accounts.findUserById(claims.sub);
    if (!user) throw unauthorized('invalid_token', 'Session is not valid.');

    if (Number(claims.tv) !== Number(user.token_version)) {
      throw unauthorized('token_revoked', 'Session has been revoked. Please sign in again.');
    }

    const membership = await accounts.findMembership(claims.sub, claims.act);
    if (!membership) throw forbidden('not_a_member', 'You do not have access to that account.');

    req.auth = {
      userId: user.id,
      email: user.email,
      emailVerifiedAt: user.email_verified_at,
      accountId: membership.account_id,
      role: membership.role,
      account: {
        id: membership.account_id,
        business_name: membership.business_name,
        slug: membership.slug,
        timezone: membership.timezone,
        google_review_url: membership.google_review_url,
      },
      subscription: {
        status: membership.subscription_status,
        trial_ends_at: membership.trial_ends_at,
        current_period_end: membership.current_period_end,
        plan: membership.plan,
      },
    };

    if (req.logContext) {
      req.logContext.accountId = membership.account_id;
      req.logContext.userId = user.id;
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * Require a verified email address.
 *
 * Applied to routes that spend money or send on the account's behalf. Without
 * it, anyone can register using someone else's address and immediately act as
 * them. Read routes stay open so a new user can still see the app while they
 * find the verification email.
 */
export function requireVerifiedEmail(req, _res, next) {
  if (!config.requireEmailVerification) return next();
  if (req.auth?.emailVerifiedAt) return next();

  return next(
    forbidden(
      'email_unverified',
      'Confirm your email address before sending. Check your inbox for the verification link.',
    ),
  );
}

const ROLE_RANK = { viewer: 0, member: 1, admin: 2, owner: 3 };

/** Route guard: the caller must hold at least `minimumRole`. */
export function requireRole(minimumRole) {
  const required = ROLE_RANK[minimumRole];
  if (required === undefined) throw new Error(`Unknown role: ${minimumRole}`);

  return (req, _res, next) => {
    const held = ROLE_RANK[req.auth?.role];
    if (held === undefined || held < required) {
      return next(forbidden('insufficient_role', `This action requires the ${minimumRole} role.`));
    }
    return next();
  };
}

/**
 * The subscription kill switch — first of three enforcement points.
 *
 * Applied to every route that costs money or creates work. Billing state is
 * re-read rather than taken from the token, so a webhook that landed a second
 * ago takes effect on this very request.
 *
 * Read paths stay open deliberately: a lapsed customer who cannot see their own
 * data or reach the billing portal does not convert back.
 */
export async function requireActiveSubscription(req, _res, next) {
  try {
    const subscription = await billing.getSubscription(req.auth.accountId);

    if (!isSubscriptionActive(subscription)) {
      logger.warn('billing.blocked_inactive', {
        accountId: req.auth.accountId,
        status: subscription?.status ?? 'missing',
      });

      throw paymentRequired(
        'subscription_inactive',
        'Your subscription is not active. Update billing to resume sending.',
      );
    }

    req.auth.subscription = subscription;
    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * Enforce a business's IP allowlist.
 *
 * Runs after requireAuth, because the allowlist is per account and there is no
 * account before then. Fails open on an internal error: this is defence in
 * depth on top of authentication, and a lookup failure must not lock a paying
 * customer out of their own dashboard.
 */
export async function enforceIpAllowlist(req, _res, next) {
  try {
    if (!req.auth?.accountId) return next();
    if (await audit.isIpAllowed(req.auth.accountId, req.ip)) return next();

    logger.warn('security.ip_blocked', {
      accountId: req.auth.accountId,
      path: req.route?.path ?? req.path,
    });

    return next(
      forbidden(
        'ip_not_allowed',
        "Your network is not on this account's allowed list. Contact an account owner.",
      ),
    );
  } catch (error) {
    logger.error('security.ip_allowlist_error', { message: error.message });
    return next();
  }
}
