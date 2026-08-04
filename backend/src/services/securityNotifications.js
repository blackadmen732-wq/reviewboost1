import { logger } from '../logger.js';
import { enqueue } from './emailService.js';

/**
 * Out-of-band security alerts.
 *
 * These exist so an account takeover cannot happen quietly. Each event is
 * something the legitimate owner wants to know within seconds, and something an
 * attacker would much rather they never saw — which is exactly why the channel
 * has to be email rather than an in-app notice the attacker could dismiss.
 *
 * Every send is best-effort. A mail failure must never block the operation it
 * describes: refusing a password change because the confirmation email bounced
 * would be a worse outcome than the missing email.
 */

function send(template, email, payload) {
  return enqueue(email, template, { when: new Date().toISOString(), ...payload }).catch((error) => {
    logger.error('security_notification.failed', { template, message: error.message });
  });
}

export function notifyNewDevice({ email, deviceLabel, location = null }) {
  return send('security_new_device', email, { deviceLabel, location });
}

export function notifyPasswordChanged({ email, deviceLabel = 'Unknown device' }) {
  return send('security_password_changed', email, { deviceLabel });
}

export function notifyAccountLocked({ email, attempts, lockMinutes }) {
  return send('security_account_locked', email, { attempts, lockMinutes });
}

export function notifySessionsRevoked({ email, count }) {
  return send('security_sessions_revoked', email, { count });
}

export function notifyMfaChanged({ email, enabled }) {
  return send('security_mfa_changed', email, { enabled });
}
