import "server-only";

import { isValidGoogleReviewUrl } from "@/lib/server/google-review-url";

/**
 * Provider-aware destination validation.
 *
 * ReviewBoost owns the door: a Tag carries `/q/{token}` and the destination
 * behind it is server state. That is only safe while every destination that
 * can be stored or served has passed through here.
 *
 * There is no "any HTTPS URL" branch and there must never be one. Without the
 * allowlist, an owner account — or a bug in one write path — turns a business's
 * own printed QR codes into an open redirect, and every customer who scans one
 * goes wherever the attacker chose.
 *
 * The rules mirror `lib/security/destination.ts` on the client and
 * `public._validate_destination_url` in the database, deliberately. Three
 * layers that disagree are a gap: whichever is loosest is the real policy, and
 * whichever is strictest produces a dead flow no log explains. Tests assert
 * they agree.
 */

export const DESTINATION_PROVIDERS = ["google"] as const;

export type DestinationProvider = (typeof DESTINATION_PROVIDERS)[number];

export interface Destination {
  provider: DestinationProvider;
  url: string;
}

export function isDestinationProvider(value: unknown): value is DestinationProvider {
  return typeof value === "string" && (DESTINATION_PROVIDERS as readonly string[]).includes(value);
}

export function isValidDestinationUrl(provider: unknown, url: unknown): boolean {
  if (typeof url !== "string" || url.length === 0 || url.length > 2048) return false;
  if (!isDestinationProvider(provider)) return false;

  switch (provider) {
    case "google":
      return isValidGoogleReviewUrl(url);
  }
}

/**
 * The destination a resolved stand actually serves, or null for a closed door.
 *
 * `google_review_url` is compatibility storage during the migration window, so
 * a row that predates the canonical columns still opens — but it is read only
 * as a fallback, and only if it validates.
 */
export function resolveDestination(row: {
  destination_provider: string | null;
  destination_url: string | null;
  google_review_url: string | null;
}): Destination | null {
  if (
    isDestinationProvider(row.destination_provider) &&
    isValidDestinationUrl(row.destination_provider, row.destination_url)
  ) {
    return { provider: row.destination_provider, url: row.destination_url as string };
  }

  if (isValidDestinationUrl("google", row.google_review_url)) {
    return { provider: "google", url: row.google_review_url as string };
  }

  return null;
}
