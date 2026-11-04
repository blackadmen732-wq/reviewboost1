import "server-only";

import { buildEntitlementSnapshot, type EntitlementSnapshot } from "@/lib/owner/entitlements";
import { isPlanId, type PlanId } from "@/lib/owner/plan-catalog";
import type { AuthenticatedContext } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import {
  allowsService,
  effectiveStatus,
  type EntitlementStatus as ServerStatus,
  locationLimit,
  tagLimit,
} from "@/lib/server/entitlements";
import { logger } from "@/lib/server/logger";

function fail(context: string, error: unknown): never {
  logger.error("entitlements.error", { context, error });
  throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
}

export async function getEntitlementSnapshot(
  context: AuthenticatedContext,
  orgId: string,
): Promise<EntitlementSnapshot> {
  const [snapshotResult, locationsResult, tagsResult] = await Promise.all([
    context.db
      .from("entitlement_snapshots")
      .select("plan_id, status, trial_ends_at")
      .eq("org_id", orgId)
      .maybeSingle(),
    context.db
      .from("locations")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .neq("status", "closed"),
    context.db
      .from("review_stands")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .neq("status", "retired"),
  ]);

  if (snapshotResult.error) fail("entitlements.snapshot", snapshotResult.error);
  if (locationsResult.error) fail("entitlements.locations", locationsResult.error);
  if (tagsResult.error) fail("entitlements.tags", tagsResult.error);

  return snapshotFromRow(
    snapshotResult.data as { plan_id: string | null; status: string; trial_ends_at: string | null } | null,
    locationsResult.count ?? 0,
    tagsResult.count ?? 0,
  );
}

/**
 * The owner-facing snapshot, with limits taken from the same model the
 * database enforces (`app.entitlement_tag_limit` / `_location_limit`,
 * mirrored in lib/server/entitlements.ts) for the status that governs now.
 *
 * It used to default a missing or planless row to an active Starter plan,
 * which told a business that had never paid it could create three Tags; the
 * database then refused the second. No row now fails closed, like the
 * database does.
 */
export function snapshotFromRow(
  row: { plan_id: string | null; status: string; trial_ends_at: string | null } | null,
  locationsUsed: number,
  tagsUsed: number,
): EntitlementSnapshot {
  const planId: PlanId | null = row && isPlanId(row.plan_id) ? row.plan_id : null;
  const stored = (row?.status ?? "suspended") as ServerStatus;
  const status = effectiveStatus(stored, row?.trial_ends_at ?? null);

  const base = buildEntitlementSnapshot({
    planId,
    status: status === "cancelled" || status === "past_due" ? status : "active",
    locationsUsed,
    tagsUsed,
  });

  const tagLimitNow = tagLimit(planId, status);
  const locationLimitNow = locationLimit(planId, status);
  const closed = status === "cancelled";
  const tags = closed ? "cancelled" : tagsUsed >= tagLimitNow ? "limit-reached" : "available";
  const locations = closed ? "cancelled" : locationsUsed >= locationLimitNow ? "limit-reached" : "available";

  return {
    ...base,
    tagLimit: tagLimitNow,
    locationLimit: locationLimitNow,
    tags,
    locations,
    canCreateTag: tags === "available",
    canCreateLocation: locations === "available",
    canUseSoftware: allowsService(status) || (status === "suspended" && planId === null),
  };
}

export function assertCanCreateTag(snapshot: EntitlementSnapshot): void {
  if (snapshot.status === "cancelled") {
    throw new ApiError(
      403,
      ERROR_CODE.forbidden,
      "This plan is cancelled. Your Tags are still here. Creating a new one is paused.",
    );
  }
  if (!snapshot.canCreateTag) {
    throw new ApiError(
      403,
      ERROR_CODE.limitReached,
      `This plan includes ${snapshot.tagLimit} Tags. You are at the limit.`,
    );
  }
}
