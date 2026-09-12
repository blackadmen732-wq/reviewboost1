import "server-only";

import { buildEntitlementSnapshot, type EntitlementSnapshot } from "@/lib/owner/entitlements";
import { isPlanId, type EntitlementStatus } from "@/lib/owner/plan-catalog";
import type { AuthenticatedContext } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
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
      .select("plan_id, status")
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

  const planId = snapshotResult.data?.plan_id;
  const status = snapshotResult.data?.status;

  return buildEntitlementSnapshot({
    planId: isPlanId(planId) ? planId : "starter",
    status: (status as EntitlementStatus | undefined) ?? "active",
    locationsUsed: locationsResult.count ?? 0,
    tagsUsed: tagsResult.count ?? 0,
  });
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
