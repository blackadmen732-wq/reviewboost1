import { timingSafeEqual } from "node:crypto";

import { ApiError, ERROR_CODE } from "@/lib/server/errors";

/**
 * Shared-secret gate for internal SMS worker routes.
 *
 * Schedulers (Vercel Cron, an external POST) present `Authorization: Bearer`.
 * `SMS_WORKER_SECRET` is the documented contract. `CRON_SECRET` is also
 * accepted because Vercel Cron sends that header automatically when set.
 *
 * When no secret is configured the route reports "not found" so its existence
 * leaks nothing. This is not a substitute for the database leases — it only
 * stops a stranger from spinning the worker.
 */

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const parts = header.split(" ");
  // Exactly "Bearer <token>" — reject trailing junk like "Bearer <token> x".
  if (parts.length !== 2) return null;
  const [scheme, token] = parts;
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function matchesSecret(token: string, secret: string | undefined): boolean {
  if (!secret) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function smsWorkerAuthorized(request: Request): boolean {
  const token = bearerToken(request);
  if (!token) return false;

  return (
    matchesSecret(token, process.env.SMS_WORKER_SECRET) ||
    matchesSecret(token, process.env.CRON_SECRET)
  );
}

export function assertSmsWorkerAuthorized(request: Request): void {
  if (!smsWorkerAuthorized(request)) {
    throw new ApiError(404, ERROR_CODE.notFound, "Not found.");
  }
}
