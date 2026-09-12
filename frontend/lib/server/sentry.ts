import "server-only";

import * as Sentry from "@sentry/nextjs";

/**
 * Sentry error reporting — server side.
 *
 * Wraps the Sentry SDK so every other module imports from here rather than
 * directly from `@sentry/nextjs`. When the DSN is not configured (local dev),
 * every call is a no-op rather than a crash.
 */

let _initialized = false;

function ensureInit(): boolean {
  if (_initialized) return true;

  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return false;

  const release = process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    ...(release ? { release } : {}),
  });

  _initialized = true;
  return true;
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!ensureInit()) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

export function captureMessage(message: string, level: "info" | "warning" | "error" = "info"): void {
  if (!ensureInit()) return;
  Sentry.captureMessage(message, level);
}

export function setUser(id: string): void {
  if (!ensureInit()) return;
  Sentry.setUser({ id });
}

export function clearUser(): void {
  if (!ensureInit()) return;
  Sentry.setUser(null);
}
