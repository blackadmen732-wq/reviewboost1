/**
 * When the app steps in after something is slow or fails, in one place, so
 * every screen keeps the same rhythm. The iPhone app keeps the same numbers in
 * `apps/mobile/data/recovery.ts`.
 *
 * Where the numbers come from (the "When Something Fails" brief has the
 * sources):
 * - Nielsen's limits: 0.1 s feels instant, 1 s keeps the flow, 10 s is as long
 *   as attention holds. So a press answers at once, a slow one says so well
 *   before 10 s, and finding out whether a change went through takes under 10.
 * - Trying again straight away meets the same trouble. Spacing the tries
 *   (3, 10, then 30 s) lets a moment's trouble pass; Gmail counts down the
 *   same way ("Reconnecting in 5 s… Try now") and TanStack Query backs off to
 *   30 s. The countdown has no random jitter, because a person reads it; only
 *   the unseen gaps between checks do.
 */

/** A button still busy after this long says "Still working…". */
export const STILL_WORKING_AFTER_MS = 4_000;

/** A page or a part of one that failed to load tries again after these. */
export const AUTO_RETRY_SECONDS = [3, 10, 30] as const;

/** Finding out whether a change went through gives its answer within this. */
export const CHECK_BUDGET_MS = 10_000;

/** Gaps between the reads of one check: at once, then about 1, 2 and 4 s. */
export const CHECK_GAPS_MS = [1_000, 2_000, 4_000] as const;

/** A check that got no answer at all is tried again after these. */
export const RECHECK_SECONDS = [10, 30] as const;
