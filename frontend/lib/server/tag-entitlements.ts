import "server-only";

import type { AuthenticatedContext } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { logger } from "@/lib/server/logger";

type PlanId = "starter" | "growth" | "pro" | null;
type EntitlementStatus = "trialing" | "active" | "past_due" | "cancelled" | "suspended";

interface EntitlementRow {
  plan_id: PlanId;
  status: EntitlementStatus;
}

function tagLimit(planId: PlanId, status: EntitlementStatus): number {
  if (status === "trialing") return 1;
  if (status !== "active") return 0;
  if (planId === "starter") return 3;
  if (planId === "growth") return 8;
  if (planId === "pro") return 25;
  return 0;
}

/**
 * Fast owner-facing pre-check for Tag creation.
 *
 * This is NOT the enforcement boundary. rpc_create_stand locks the same
 * organization's entitlement row and repeats the limit check inside the create
 * transaction, so concurrent requests and direct RPC callers cannot bypass it.
 */
export async function assertCanCreateTag(
  context: AuthenticatedContext,
  orgId: string,
  requestId: string,
): Promise<void> {
  const { data: entitlement, error: entitlementError } = await context.db
    .from("entitlement_snapshots")
    .select("plan_id, status")
    .eq("org_id", orgId)
    .maybeSingle();

  if (entitlementError) {
    logger.error("tags.entitlement_lookup_failed", { requestId, orgId, error: entitlementError });
    throw new ApiError(
      503,
      ERROR_CODE.serviceUnavailable,
      "Tag limits are temporarily unavailable. Please try again shortly.",
    );
  }

  if (!entitlement) {
    logger.error("tags.entitlement_missing", { requestId, orgId });
    throw new ApiError(
      503,
      ERROR_CODE.serviceUnavailable,
      "Tag limits are temporarily unavailable. Please try again shortly.",
    );
  }

  const row = entitlement as EntitlementRow;
  const limit = tagLimit(row.plan_id, row.status);

  if (limit <= 0) {
    throw new ApiError(
      403,
      ERROR_CODE.forbidden,
      "Your plan is not active, so a new Tag cannot be created.",
    );
  }

  const { count, error: countError } = await context.db
    .from("review_stands")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .neq("status", "retired");

  if (countError) {
    logger.error("tags.limit_count_failed", { requestId, orgId, error: countError });
    throw new ApiError(
      503,
      ERROR_CODE.serviceUnavailable,
      "Tag limits are temporarily unavailable. Please try again shortly.",
    );
  }

  if ((count ?? 0) >= limit) {
    throw new ApiError(
      403,
      ERROR_CODE.forbidden,
      `Your plan allows ${limit} ${limit === 1 ? "Tag" : "Tags"}. Retire a Tag or change plans before creating another.`,
    );
  }
}
