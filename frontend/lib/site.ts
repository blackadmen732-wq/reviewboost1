/**
 * The canonical public origin, in one place.
 *
 * `docs/backend/ENVIRONMENT.md` and `.env.example` both name reviewboost.fit as
 * production; reviewboost.app is the retired alternative. Contact addresses on
 * it were dead mailboxes, and a canonical URL on it would be worse — it would
 * hand search engines a second origin to index and split the site against
 * itself.
 *
 * Deliberately a constant rather than `publicFrontendUrl()`. That accessor is
 * server-only and throws in production when unset, which is right for the
 * origin printed onto a physical Tag but wrong for page metadata: a missing
 * environment variable should not fail a build or take down a marketing page.
 * The two are checked against each other by test.
 */
export const SITE_URL = "https://reviewboost.fit";

/** Absolute URL for a path, for canonicals and social cards. */
export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}

/**
 * Every public, indexable route.
 *
 * The sitemap and the robots allow-list both read this, so adding a page in one
 * and forgetting the other stops being possible. Owner routes, `/login` and
 * `/q/{token}` are deliberately absent — a customer's Tag page is not a
 * marketing landing page and must never be indexed as one.
 */
export const PUBLIC_ROUTES = [
  "/",
  "/product",
  "/how-it-works",
  "/pricing",
  "/integrity",
  "/security",
  "/privacy",
  "/terms",
  "/support",
  // Both app stores require a publicly reachable deletion URL, readable by
  // somebody who has already lost access to their account.
  "/delete-account",
] as const;
