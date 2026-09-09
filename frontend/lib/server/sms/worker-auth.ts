import "server-only";

import { timingSafeEqual } from "node:crypto";

/**
 * Shared secret for internal SMS workers (dispatch, reconcile, expire).
 *
 * Accepts either SMS_WORKER_SECRET (manual / external scheduler) or
 * CRON_SECRET (Vercel Cron Authorization: Bearer <CRON_SECRET>). When no
 * secret is configured the route reports "not found" so its existence
 * leaks nothing.
 */

export function authorizeSmsWorker(request: Request): boolean {
  const secrets = [process.env.SMS_WORKER_SECRET, process.env.CRON_SECRET].filter(
    (value): value is string => Boolean(value && value.length > 0),
  );
  if (secrets.length === 0) return false;

  const header = request.headers.get("authorization") ?? "";
  const parts = header.split(" ");
  if (parts.length !== 2) return false;
  const [scheme, token] = parts;
  if (scheme?.toLowerCase() !== "bearer" || !token) return false;

  const presented = Buffer.from(token);
  return secrets.some((secret) => {
    const expected = Buffer.from(secret);
    return presented.length === expected.length && timingSafeEqual(presented, expected);
  });
}
