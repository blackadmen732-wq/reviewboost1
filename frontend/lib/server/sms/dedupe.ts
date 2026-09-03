import "server-only";

import { keyedDigest } from "@/lib/server/crypto";

/**
 * Dedupe-key derivation for Text Requests.
 *
 * The database is the real dedupe boundary — `text_requests` has a unique
 * (org_id, dedupe_key), so two schedules that resolve to the same key converge
 * on one row no matter how many clicks, retries, or concurrent workers produced
 * them. This module only derives a stable key deterministically; it never
 * decides uniqueness in application memory.
 *
 * A review-request key is (recipient, stand, time-bucket): the same recipient
 * for the same stand inside one window is one intended send. The bucket makes
 * "don't text the same person about the same stand twice today" expressible
 * without trusting a client-supplied key — though an explicit Idempotency-Key,
 * when supplied, takes precedence so a deliberate retry is exact.
 */

const DEFAULT_WINDOW_SECONDS = 24 * 60 * 60;

/** The UTC bucket index for an instant, given a window length. */
export function timeBucket(now: Date, windowSeconds: number = DEFAULT_WINDOW_SECONDS): number {
  return Math.floor(now.getTime() / 1000 / windowSeconds);
}

export interface ReviewRequestKeyInput {
  orgId: string;
  phoneHash: string;
  standId: string;
  now: Date;
  windowSeconds?: number;
  /** An explicit client idempotency key overrides the derived bucket key. */
  explicitKey?: string | undefined;
}

export function reviewRequestDedupeKey(input: ReviewRequestKeyInput): string {
  if (input.explicitKey) {
    return keyedDigest(input.explicitKey, "sms_dedupe_explicit");
  }
  const bucket = timeBucket(input.now, input.windowSeconds ?? DEFAULT_WINDOW_SECONDS);
  return keyedDigest(
    `${input.orgId}|${input.standId}|${input.phoneHash}|${bucket}`,
    "sms_dedupe_review_request",
  );
}
