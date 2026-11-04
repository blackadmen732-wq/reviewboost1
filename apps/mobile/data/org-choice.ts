import type { Organization } from "./types";

/**
 * Which business the app opens on, after the memberships load.
 *
 * Asking someone with one business to choose it, every launch, was a screen
 * of friction with one button on it. The website remembers the last choice in
 * a cookie (rb-active-org); the app remembers it on the phone. The server
 * still checks membership on every request, so a remembered id only ever
 * picks among businesses the person belongs to right now.
 */
export function chooseActiveOrg(
  current: Organization | null,
  organizations: readonly Organization[],
  rememberedId: string | null,
): Organization | null {
  const kept = current ? organizations.find((org) => org.orgId === current.orgId) : undefined;
  if (kept) return kept;
  const remembered = rememberedId ? organizations.find((org) => org.orgId === rememberedId) : undefined;
  if (remembered) return remembered;
  return organizations.length === 1 ? organizations[0]! : null;
}

export function lastOrgKey(userId: string): string {
  return `reviewboost:last-business:${userId}`;
}
