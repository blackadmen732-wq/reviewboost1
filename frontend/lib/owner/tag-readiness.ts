/**
 * Tag list/detail read-model. One stand, one token. Status is what the owner
 * still has to do — not a second QR/NFC capability.
 *
 * Needs NFC: never programmed, or the code changed after the last program.
 * Needs QR: the code changed, so the printed copy is dead.
 * Both: reprint and program.
 * Ready: programmed and the code has not moved since.
 */

import { relativeDay } from "@/lib/utils/relative-day";

export type TagReadiness = "ready" | "needs-qr" | "needs-nfc" | "both";

export interface TagReadinessInput {
  nfcProvisionedAt: string | null;
  tokenRotatedAt: string | null;
}

export function tagNeedsRewrite(input: TagReadinessInput): boolean {
  if (input.tokenRotatedAt === null) return false;
  // Rotation clears the programmed date. Null after a rotation still means
  // the chip and printed code on the counter carry the old link.
  return (
    input.nfcProvisionedAt === null ||
    new Date(input.tokenRotatedAt) > new Date(input.nfcProvisionedAt)
  );
}

export function tagReadiness(input: TagReadinessInput): TagReadiness {
  const needsNfc = input.nfcProvisionedAt === null || tagNeedsRewrite(input);
  const needsQr = tagNeedsRewrite(input);

  if (needsNfc && needsQr) return "both";
  if (needsNfc) return "needs-nfc";
  if (needsQr) return "needs-qr";
  return "ready";
}

/**
 * The Tag's state in an owner's words. "Needs NFC" and "Both" were the old
 * labels: accurate, and nobody could act on them.
 *
 * needs-nfc only happens before the first program (a rotation always makes
 * the printed code stale too), so it reads as "tap not set up"; both means
 * the code changed, so the printout and the chip carry the old link.
 */
export function tagReadinessLabel(status: TagReadiness): string {
  if (status === "ready") return "Ready";
  if (status === "needs-qr") return "Reprint the code";
  if (status === "needs-nfc") return "Tap not set up";
  return "Code changed: reprint and set up tap";
}

export function lastUsedLabel(
  iso: string | null,
  timeZone: string,
  now: number = Date.now(),
): string {
  if (!iso) return "Not used yet";
  // The same calendar days as a rating's "Yesterday" (`relativeDay`): a Tag
  // opened last night was used yesterday, however few hours ago that was.
  const day = relativeDay(iso, timeZone, now);
  if (day === "Today") return "Used today";
  if (day === "Yesterday") return "Used yesterday";
  return `Used ${day}`;
}
