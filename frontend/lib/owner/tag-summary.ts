import { tagNeedsRewrite } from "@/lib/owner/tag-readiness";

/** The parts of a Tag that Home and the Tags page read. */
export interface HomeStand {
  standId: string;
  label: string;
  status: string;
  nfcProvisionedAt: string | null;
  tokenRotatedAt: string | null;
}

export interface TagStatus {
  total: number;
  live: number;
  programmed: number;
  needsRewrite: number;
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
  };
}
