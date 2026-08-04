import { Router } from 'express';

import { config } from '../../config/index.js';
import { formatCents, usagePercent } from '../../domain/pricing.js';
import * as accountRepo from '../../repositories/accountRepository.js';
import * as audit from '../../repositories/auditRepository.js';
import * as billing from '../../repositories/billingRepository.js';
import * as messaging from '../../repositories/messagingRepository.js';
import * as qrRepo from '../../repositories/qrRepository.js';
import {
  PLANS,
  createCheckoutSession,
  createPortalSession,
  isSubscriptionActive,
} from '../../services/billingService.js';
import { hashIp } from '../../services/encryption.js';
import { scanUrlFor } from '../../services/qrService.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { enforceIpAllowlist, requireAuth, requireRole } from '../middleware/auth.js';
import { asyncRoute, validate } from '../middleware/core.js';
import { billingLimiter, writeLimiter } from '../middleware/rateLimit.js';
import {
  inviteMemberSchema,
  ipAllowlistSchema,
  paginationSchema,
  toggleAllowlistSchema,
  updateAccountSchema,
  uuidParamSchema,
} from '../schemas.js';

export const dashboardRoutes = Router();

dashboardRoutes.use(requireAuth);
dashboardRoutes.use(enforceIpAllowlist);

/** Everything the owner's home screen needs, in one round trip. */
dashboardRoutes.get(
  '/',
  asyncRoute(async (req, res) => {
    const accountId = req.auth.accountId;

    const [stats, usage, subscription, activity, scans, stands] = await Promise.all([
      messaging.accountDashboard(accountId),
      billing.getMonthlyUsage(accountId),
      billing.getSubscription(accountId),
      billing.dailyUsage(accountId, 30),
      qrRepo.scanAnalytics(accountId, 30),
      qrRepo.listStands(accountId),
    ]);

    const allowance = subscription?.monthly_sms_allowance ?? 0;

    res.json({
      account: req.auth.account,
      role: req.auth.role,
      metrics: {
        messagesSent: stats.messages_total,
        messagesDelivered: stats.messages_delivered,
        messagesFailed: stats.messages_failed,
        deliveryRatePercent:
          stats.messages_total > 0
            ? Math.round((stats.messages_delivered / stats.messages_total) * 100)
            : 0,
        contacts: stats.contacts_total,
        suppressed: stats.suppressed_total,
        scans: stats.scans_total,
        feedbackIntercepted: stats.feedback_intercepted,
        averagePrivateRating: Number(stats.average_private_rating ?? 0),
        interceptRatePercent:
          stats.scans_total > 0
            ? Math.round((stats.feedback_intercepted / stats.scans_total) * 100)
            : 0,
        spendInCents: stats.spend_in_cents,
        spendFormatted: formatCents(stats.spend_in_cents),
      },
      usage: {
        messagesThisMonth: usage.messages_sent,
        segmentsThisMonth: usage.segments_sent,
        costThisMonthCents: usage.cost_in_cents,
        costThisMonthFormatted: formatCents(usage.cost_in_cents),
        allowance,
        remaining: Math.max(0, allowance - usage.messages_sent),
        percentUsed: usagePercent(usage.messages_sent, allowance),
      },
      subscription: {
        status: subscription?.status ?? 'none',
        plan: subscription?.plan ?? null,
        active: isSubscriptionActive(subscription),
        trialEndsAt: subscription?.trial_ends_at ?? null,
        currentPeriodEnd: subscription?.current_period_end ?? null,
        cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
      },
      charts: { dailyUsage: activity, scans: scans.daily, devices: scans.byDevice },
      stands: stands.map((stand) => ({
        id: stand.id,
        label: stand.label,
        scanUrl: scanUrlFor(stand.public_id),
        scansTotal: stand.scans_count,
        scansLast30Days: stand.scans_last_30_days,
        isActive: stand.is_active,
      })),
    });
  }),
);

// ------------------------------------------------------------- settings ----

dashboardRoutes.patch(
  '/account',
  requireRole('admin'),
  writeLimiter,
  validate(updateAccountSchema),
  asyncRoute(async (req, res) => {
    const account = await accountRepo.updateAccount(req.auth.accountId, req.body);

    await audit.record({
      accountId: req.auth.accountId,
      actorUserId: req.auth.userId,
      action: 'account.updated',
      metadata: { fields: Object.keys(req.body) },
      ipHash: hashIp(req.ip),
    });

    res.json({ account });
  }),
);

// ----------------------------------------------------------------- team ----

dashboardRoutes.get(
  '/members',
  asyncRoute(async (req, res) => {
    res.json({ members: await accountRepo.listMembers(req.auth.accountId) });
  }),
);

dashboardRoutes.post(
  '/members',
  requireRole('admin'),
  writeLimiter,
  validate(inviteMemberSchema),
  asyncRoute(async (req, res) => {
    const user = await accountRepo.findUserByEmail(req.body.email);

    // Responds identically whether or not the address has an account. A
    // distinguishable error would turn this into an oracle for testing which
    // emails are registered with ReviewBoost.
    if (!user) {
      return res.status(202).json({
        ok: true,
        message: 'If that email has a ReviewBoost account, they now have access.',
      });
    }

    const membership = await accountRepo.upsertMember({
      accountId: req.auth.accountId,
      userId: user.id,
      role: req.body.role,
    });

    await audit.record({
      accountId: req.auth.accountId,
      actorUserId: req.auth.userId,
      action: 'team.member_added',
      targetType: 'user',
      targetId: user.id,
      metadata: { role: req.body.role },
    });

    return res.status(201).json({ membership });
  }),
);

dashboardRoutes.delete(
  '/members/:userId',
  requireRole('admin'),
  validate(uuidParamSchema('userId'), 'params'),
  asyncRoute(async (req, res) => {
    const result = await accountRepo.removeMember(req.auth.accountId, req.params.userId);

    if (!result.removed) {
      throw result.reason === 'last_owner'
        ? conflict('last_owner', 'An account must keep at least one owner.')
        : notFound('member_not_found', 'That member was not found.');
    }

    await audit.record({
      accountId: req.auth.accountId,
      actorUserId: req.auth.userId,
      action: 'team.member_removed',
      targetType: 'user',
      targetId: req.params.userId,
    });

    res.status(204).end();
  }),
);

// -------------------------------------------------------------- billing ----

dashboardRoutes.get(
  '/billing',
  asyncRoute(async (req, res) => {
    const [subscription, usage] = await Promise.all([
      billing.getSubscription(req.auth.accountId),
      billing.getMonthlyUsage(req.auth.accountId),
    ]);

    res.json({
      subscription,
      usage,
      active: isSubscriptionActive(subscription),
      plans: Object.entries(PLANS).map(([key, plan]) => ({
        key,
        ...plan,
        priceFormatted: formatCents(plan.priceInCents),
      })),
    });
  }),
);

dashboardRoutes.post(
  '/billing/checkout',
  requireRole('owner'),
  billingLimiter,
  asyncRoute(async (req, res) => {
    const appUrl = config.publicAppUrl ?? '';
    res.json(
      await createCheckoutSession({
        accountId: req.auth.accountId,
        email: req.auth.email,
        successUrl: `${appUrl}/billing?status=success`,
        cancelUrl: `${appUrl}/billing?status=cancelled`,
      }),
    );
  }),
);

dashboardRoutes.post(
  '/billing/portal',
  requireRole('owner'),
  billingLimiter,
  asyncRoute(async (req, res) => {
    res.json(
      await createPortalSession({
        accountId: req.auth.accountId,
        returnUrl: `${config.publicAppUrl ?? ''}/billing`,
      }),
    );
  }),
);

// -------------------------------------------------------------- security ---

dashboardRoutes.get(
  '/audit',
  requireRole('admin'),
  validate(paginationSchema, 'query'),
  asyncRoute(async (req, res) => {
    res.json({ events: await audit.list(req.auth.accountId, req.validatedQuery) });
  }),
);

dashboardRoutes.get(
  '/security/ip-allowlist',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    res.json(await audit.listAllowlist(req.auth.accountId));
  }),
);

dashboardRoutes.post(
  '/security/ip-allowlist',
  requireRole('owner'),
  writeLimiter,
  validate(ipAllowlistSchema),
  asyncRoute(async (req, res) => {
    const entry = await audit.addAllowlistEntry(req.auth.accountId, {
      cidr: req.body.cidr,
      label: req.body.label,
      userId: req.auth.userId,
    });

    await audit.record({
      accountId: req.auth.accountId,
      actorUserId: req.auth.userId,
      action: 'security.ip_allowlist_added',
      metadata: { cidr: req.body.cidr },
    });

    res.status(201).json({ entry });
  }),
);

dashboardRoutes.delete(
  '/security/ip-allowlist/:entryId',
  requireRole('owner'),
  validate(uuidParamSchema('entryId'), 'params'),
  asyncRoute(async (req, res) => {
    if (!(await audit.removeAllowlistEntry(req.auth.accountId, req.params.entryId))) {
      throw notFound('entry_not_found', 'That allowlist entry was not found.');
    }

    await audit.record({
      accountId: req.auth.accountId,
      actorUserId: req.auth.userId,
      action: 'security.ip_allowlist_removed',
      targetId: req.params.entryId,
    });

    res.status(204).end();
  }),
);

/**
 * Turn the allowlist on or off.
 *
 * Enabling requires the caller's own address to already be covered — otherwise
 * they immediately lock themselves out of their own account with no way back in.
 */
dashboardRoutes.post(
  '/security/ip-allowlist/toggle',
  requireRole('owner'),
  writeLimiter,
  validate(toggleAllowlistSchema),
  asyncRoute(async (req, res) => {
    if (req.body.enabled) {
      if ((await audit.countAllowlistEntries(req.auth.accountId)) === 0) {
        throw badRequest(
          'allowlist_empty',
          'Add at least one allowed IP range before turning this on.',
        );
      }

      if (!(await audit.isIpAllowed(req.auth.accountId, req.ip))) {
        throw badRequest(
          'would_lock_you_out',
          'Your current network is not on the list. Add it first, or you will be locked out.',
        );
      }
    }

    const enabled = await audit.setAllowlistEnabled(req.auth.accountId, req.body.enabled);

    await audit.record({
      accountId: req.auth.accountId,
      actorUserId: req.auth.userId,
      action: enabled ? 'security.ip_allowlist_enabled' : 'security.ip_allowlist_disabled',
    });

    res.json({ enabled });
  }),
);

// -------------------------------------------------------------- contacts ---

dashboardRoutes.get(
  '/contacts',
  validate(paginationSchema, 'query'),
  asyncRoute(async (req, res) => {
    const { contacts, total } = await messaging.listContacts(
      req.auth.accountId,
      req.validatedQuery,
    );

    // Contact PII is returned masked; the dashboard never needs full numbers.
    const { pii } = await import('../../services/encryption.js');
    res.json({
      total,
      contacts: contacts.map((contact) => ({
        id: contact.id,
        name: pii.tryDecrypt(contact.name_encrypted),
        phone: maskPhone(pii.tryDecrypt(contact.phone_encrypted)),
        consent: contact.consent,
        consentAt: contact.consent_at,
        timezone: contact.timezone,
        createdAt: contact.created_at,
      })),
    });
  }),
);

dashboardRoutes.get(
  '/suppressions',
  validate(paginationSchema, 'query'),
  asyncRoute(async (req, res) => {
    res.json({
      suppressions: await messaging.listSuppressions(req.auth.accountId, req.validatedQuery),
    });
  }),
);

function maskPhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : null;
}
