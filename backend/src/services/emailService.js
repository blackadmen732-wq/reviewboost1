import { config } from '../config/index.js';
import { hashToken, randomToken } from '../domain/crypto.js';
import { logger } from '../logger.js';
import * as tokens from '../repositories/tokenRepository.js';
import { pii } from './encryption.js';

/**
 * Transactional email.
 *
 * Messages are written to an outbox table rather than sent inline, so a slow or
 * failing provider can never block a password change, and every send is
 * retryable and auditable. Delivery is drained by the maintenance job.
 */

// ------------------------------------------------------ verification -------

/**
 * Issue a single-use token and return the plaintext.
 *
 * Only the HMAC is stored, so a database disclosure cannot be replayed against
 * the reset flow. Any outstanding token for the same purpose is invalidated
 * first — an old reset email sitting in an inbox must not stay live.
 */
export async function issueUserToken(userId, purpose) {
  await tokens.invalidateUserTokens({ userId, purpose });

  const token = randomToken(32);
  await tokens.createUserToken({
    userId,
    purpose,
    tokenHash: hashToken(token, config.jwtSecret, purpose),
  });

  return token;
}

export function consumeUserToken(token, purpose) {
  return tokens.consumeUserToken({
    tokenHash: hashToken(String(token ?? ''), config.jwtSecret, purpose),
    purpose,
  });
}

// ------------------------------------------------------------ sending ------

export async function enqueue(to, template, payload = {}) {
  await tokens.enqueueEmail({ toEncrypted: pii.encrypt(to), template, payload });
  logger.info('email.queued', { template });
}

export async function sendVerificationEmail(user) {
  const token = await issueUserToken(user.id, 'email_verification');
  await enqueue(user.email, 'verify_email', {
    verifyUrl: `${config.publicAppUrl ?? ''}/verify-email?token=${token}`,
    name: user.full_name ?? '',
  });
}

export async function sendPasswordResetEmail(user) {
  const token = await issueUserToken(user.id, 'password_reset');
  await enqueue(user.email, 'password_reset', {
    resetUrl: `${config.publicAppUrl ?? ''}/reset-password?token=${token}`,
    name: user.full_name ?? '',
  });
}

// ---------------------------------------------------------- templates ------

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
}

function layout(heading, body) {
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;padding:24px;
    font:16px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color:#111827">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
      <h1 style="font-size:1.25rem;margin:0 0 16px">${escapeHtml(heading)}</h1>
      ${body}
      <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:.8rem;color:#6b7280;margin:0">ReviewBoost</p>
    </div></body></html>`;
}

function button(url, label) {
  const safe = escapeHtml(url);
  return `<p><a href="${safe}" style="display:inline-block;background:#2563eb;color:#fff;
            padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">
            ${escapeHtml(label)}</a></p>
          <p style="font-size:.85rem;color:#6b7280;word-break:break-all">
            Or paste this into your browser:<br>${safe}</p>`;
}

function detailRows(rows) {
  return `<table style="border-collapse:collapse;margin:16px 0;font-size:.92rem">${rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#6b7280">${escapeHtml(label)}</td>
             <td style="padding:4px 0"><strong>${escapeHtml(String(value ?? '—'))}</strong></td></tr>`,
    )
    .join('')}</table>`;
}

function formatWhen(value) {
  const date = new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? String(value) : date.toUTCString();
}

/**
 * Every template.
 *
 * The security alerts exist so an account takeover cannot happen silently, and
 * each ends with a concrete action rather than just an observation.
 */
const TEMPLATES = {
  verify_email: (payload) => ({
    subject: 'Confirm your ReviewBoost email',
    html: layout(
      'Confirm your email',
      `<p>Hi${payload.name ? ` ${escapeHtml(payload.name)}` : ''},</p>
       <p>Confirm your email address to finish setting up ReviewBoost.</p>
       ${button(payload.verifyUrl, 'Confirm email')}
       <p style="font-size:.85rem;color:#6b7280">This link expires in 24 hours. If you did not
       create a ReviewBoost account, you can ignore this email.</p>`,
    ),
  }),

  password_reset: (payload) => ({
    subject: 'Reset your ReviewBoost password',
    html: layout(
      'Reset your password',
      `<p>Hi${payload.name ? ` ${escapeHtml(payload.name)}` : ''},</p>
       <p>Choose a new password using the link below.</p>
       ${button(payload.resetUrl, 'Reset password')}
       <p style="font-size:.85rem;color:#6b7280">This link expires in 1 hour and works once.
       If you did not request a reset, ignore this email — your password has not changed.</p>`,
    ),
  }),

  security_new_device: (payload) => ({
    subject: 'New sign-in to your ReviewBoost account',
    html: layout(
      'New device signed in',
      `<p>Your account was signed into from a device we have not seen before.</p>
       ${detailRows([
         ['Device', payload.deviceLabel],
         ['Location', payload.location ?? 'Unknown'],
         ['When', formatWhen(payload.when)],
       ])}
       <p><strong>If this was you, no action is needed.</strong></p>
       <p style="font-size:.85rem;color:#6b7280">If it was not, change your password and sign
       out all devices from Settings &rarr; Security.</p>`,
    ),
  }),

  security_password_changed: (payload) => ({
    subject: 'Your ReviewBoost password was changed',
    html: layout(
      'Password changed',
      `<p>The password on your account was changed. All other sessions have been signed out.</p>
       ${detailRows([
         ['Device', payload.deviceLabel ?? 'Unknown device'],
         ['When', formatWhen(payload.when)],
       ])}
       <p style="font-size:.85rem;color:#6b7280">If you did not do this, reset your password
       immediately — someone else may have access.</p>`,
    ),
  }),

  security_account_locked: (payload) => ({
    subject: 'ReviewBoost account temporarily locked',
    html: layout(
      'Account locked after failed sign-ins',
      `<p>We locked your account after ${escapeHtml(String(payload.attempts))} failed sign-in
       attempts. This protects you while someone is guessing your password.</p>
       ${detailRows([['When', formatWhen(payload.when)]])}
       <p>The lock clears automatically in ${escapeHtml(String(payload.lockMinutes ?? 15))} minutes.</p>
       <p style="font-size:.85rem;color:#6b7280">If this was not you, someone is trying to get
       into your account. Change your password once the lock lifts, and turn on two-factor
       authentication.</p>`,
    ),
  }),

  security_sessions_revoked: (payload) => ({
    subject: 'ReviewBoost devices signed out',
    html: layout(
      'Signed out',
      `<p>${escapeHtml(String(payload.count))} session${payload.count === 1 ? ' was' : 's were'}
       signed out of your account.</p>
       ${detailRows([['When', formatWhen(payload.when)]])}
       <p style="font-size:.85rem;color:#6b7280">If you did not do this, change your password
       immediately.</p>`,
    ),
  }),

  security_mfa_changed: (payload) => ({
    subject: `Two-factor authentication ${payload.enabled ? 'enabled' : 'disabled'}`,
    html: layout(
      `Two-factor authentication ${payload.enabled ? 'enabled' : 'disabled'}`,
      `<p>Two-factor authentication was ${payload.enabled ? 'turned on' : 'turned off'} for your
       account.</p>
       ${detailRows([['When', formatWhen(payload.when)]])}
       <p style="font-size:.85rem;color:#6b7280">If you did not do this, someone else has access
       to your account. Change your password immediately.</p>`,
    ),
  }),
};

export function renderTemplate(template, payload) {
  const build = TEMPLATES[template];
  if (!build) throw new Error(`Unknown email template: ${template}`);
  return build(payload ?? {});
}

// ----------------------------------------------------------- delivery ------

/**
 * Deliver one message via Resend.
 *
 * Throws on failure so the outbox records the attempt and retries with the
 * others. Without a provider configured it logs instead — production refuses to
 * start unless one is set, because a password reset that silently never arrives
 * is worse than no reset feature at all.
 */
async function deliver({ to, template, payload }) {
  const { subject, html } = renderTemplate(template, payload);

  if (!config.emailConfigured) {
    logger.warn('email.no_provider_configured', { template, subject });
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.emailFrom,
      to: [to],
      subject,
      html,
      ...(config.emailReplyTo ? { reply_to: config.emailReplyTo } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    // The body is read for diagnostics but truncated and never logged verbatim
    // — provider errors echo the recipient address back.
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend responded ${response.status}: ${detail.slice(0, 200)}`);
  }

  logger.info('email.delivered', { template });
}

/** Drain the outbox. Called by the maintenance job. */
export async function flushOutbox({ batchSize = 50 } = {}) {
  const claimed = await tokens.claimPendingEmails({ batchSize });
  let delivered = 0;

  for (const row of claimed) {
    try {
      await deliver({
        to: pii.decrypt(row.to_encrypted),
        template: row.template,
        payload: row.payload,
      });
      await tokens.markEmailSent(row.id);
      delivered += 1;
    } catch (error) {
      await tokens.markEmailFailed(row.id, error.message);
      logger.error('email.delivery_failed', {
        template: row.template,
        attempts: row.attempts,
        message: error.message,
      });
    }
  }

  return { attempted: claimed.length, delivered };
}
