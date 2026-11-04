import { tagNeedsRewrite } from "@/lib/owner/tag-readiness";

/** The parts of a Tag that Home and the Tags page read. */
export interface HomeStand {
  standId: string;
  label: string;
  status: string;
  nfcProvisionedAt: string | null;
  tokenRotatedAt: string | null;
  /** Last opened by someone, by tap or scan. */
  lastOpenedAt?: string | null;
}

export interface TagStatus {
  total: number;
  live: number;
  programmed: number;
  needsRewrite: number;
  /**
   * Active Tags that work on the counter today: tap is set up, or someone
   * has opened the current code. A printed code is as good as a chip ("Either
   * works"), so a Tag customers already scan is set up, chip or not.
   */
  inUse: number;
}

/** Set up and working: its chip carries the link, or its current code has been opened. */
export function tagInUse(stand: HomeStand): boolean {
  if (stand.status !== "active" || tagNeedsRewrite(stand)) return false;
  if (stand.nfcProvisionedAt !== null) return true;
  const opened = stand.lastOpenedAt ?? null;
  if (opened === null) return false;
  // Opened before the code changed means the old, dead code was opened.
  return stand.tokenRotatedAt === null || new Date(opened) > new Date(stand.tokenRotatedAt);
}

/**
 * Only an active Tag is doing anything for the business.
 *
 * programmed and needsRewrite deliberately count active Tags alone. A retired
 * Tag whose code has moved on is not work anybody should be nagged about, and
 * counting a paused one as programmed made setup look finished while nothing on
 * the counter actually worked. `total` stays every Tag, because the list still
 * shows them.
 */
export function summarizeTags(stands: HomeStand[]): TagStatus {
  const active = stands.filter((stand) => stand.status === "active");
  return {
    total: stands.length,
    live: active.length,
    programmed: active.filter((stand) => stand.nfcProvisionedAt !== null).length,
    needsRewrite: active.filter(tagNeedsRewrite).length,
    inUse: active.filter(tagInUse).length,
  };
}
