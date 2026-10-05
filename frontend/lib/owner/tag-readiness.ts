/**
 * Tag list/detail read-model. One stand, one token. Status is what the owner
 * still has to do — not a second QR/NFC capability.
 *
 * Needs NFC: never programmed, or the code changed after the last program.
 * Needs QR: the code changed, so the printed copy is dead — until a chip is
 * programmed with the new link or a customer has opened the new one.
 * Both: reprint and program.
 * Ready: programmed and the code has not moved since.
 */

export type TagReadiness = "ready" | "needs-qr" | "needs-nfc" | "both";

export interface TagReadinessInput {
  nfcProvisionedAt: string | null;
  tokenRotatedAt: string | null;
  /**
   * The last time a customer opened this Tag. Optional: a caller without it
   * gets the stricter answer (a changed code is assumed not yet reprinted).
   */
  lastOpenedAt?: string | null;
}

function isAfter(a: string | null | undefined, b: string | null | undefined): boolean {
  return a != null && b != null && new Date(a) > new Date(b);
}

/**
 * The Tag's link changed and no chip has been programmed with the new one.
 *
 * "Make a new code" (`rpc_rotate_stand_token`) stamps `token_rotated_at` and
 * clears `nfc_provisioned_at`. So after a rotation the programmed date is null,
 * not older than the rotation — this used to require both dates to be set,
 * which meant a rotation was never seen: the list said the dead printed code
 * was fine and Home never asked for a reprint. A null programmed date with a
 * rotation means whatever chip is on the counter carries the old link.
 */
export function tagNeedsRewrite(input: TagReadinessInput): boolean {
  if (input.tokenRotatedAt === null) return false;
  return input.nfcProvisionedAt === null || isAfter(input.tokenRotatedAt, input.nfcProvisionedAt);
}

/**
 * The printed QR carries a link that no longer works.
 *
 * True from the rotation until the new link is demonstrably out there: a chip
 * programmed with it, or a customer who opened the Tag after the change (only
 * the new link resolves, so any open since the rotation came through it).
 */
export function printedCodeIsStale(input: TagReadinessInput): boolean {
  if (!tagNeedsRewrite(input)) return false;
  return !isAfter(input.lastOpenedAt, input.tokenRotatedAt);
}

export function tagReadiness(input: TagReadinessInput): TagReadiness {
  const needsNfc = input.nfcProvisionedAt === null || tagNeedsRewrite(input);
  const needsQr = printedCodeIsStale(input);

  if (needsNfc && needsQr) return "both";
  if (needsNfc) return "needs-nfc";
  if (needsQr) return "needs-qr";
  return "ready";
}

export function tagReadinessLabel(status: TagReadiness): string {
  if (status === "ready") return "Ready";
  if (status === "needs-qr") return "Needs QR";
  if (status === "needs-nfc") return "Needs NFC";
  return "Both";
}

export function lastUsedLabel(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "Not used yet";
  const then = new Date(iso);
  const days = Math.floor((now - then.getTime()) / 86_400_000);
  if (days <= 0) return "Used today";
  if (days === 1) return "Used yesterday";
  if (days < 7) return `Used ${days} days ago`;
  return `Used ${then.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}
