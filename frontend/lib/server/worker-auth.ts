import "server-only";

import { timingSafeEqual } from "node:crypto";

/**
 * Who may spin a worker.
 *
 * Two callers are legitimate: our own scheduler, holding `SMS_WORKER_SECRET`,
 * and the hosting platform's cron, holding `CRON_SECRET`. Both present a
 * bearer token and both are compared in constant time.
 *
 * With neither secret configured, nothing is authorized. That is deliberate:
 * a worker endpoint that falls open when its configuration is missing is a
 * public endpoint that drains an outbox for anyone who finds it.
 *
 * The real safety is downstream — leases, single-in-flight attempts, and
 * idempotency keys mean an extra invocation cannot double a send. This only
 * stops a stranger from spinning the wheel.
 */
export function workerAuthorized(request: Request): boolean {
  const secrets = [process.env.SMS_WORKER_SECRET, process.env.CRON_SECRET].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  if (secrets.length === 0) return false;

  const header = request.headers.get("authorization") ?? "";
  const parts = header.split(" ");
  // Exactly "Bearer <token>" — reject trailing junk like "Bearer <token> x".
  if (parts.length !== 2) return false;
  const [scheme, token] = parts;
  if (scheme?.toLowerCase() !== "bearer" || !token) return false;

  const presented = Buffer.from(token);
  return secrets.some((secret) => {
    const expected = Buffer.from(secret);
    // Length is compared first because timingSafeEqual throws on a mismatch.
    // The length of a secret is not the secret.
    return presented.length === expected.length && timingSafeEqual(presented, expected);
  });
}
