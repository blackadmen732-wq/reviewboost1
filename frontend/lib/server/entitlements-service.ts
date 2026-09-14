import "server-only";

import type { AuthenticatedContext } from "@/lib/server/auth";
import {
  isEntitlementStatus,
  isPlanId,
  locationLimitOf,
  tagLimitOf,
  type EntitlementStatus,
  type PlanId,
} from "@/lib/owner/entitlement-limits";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { logger } from "@/lib/server/logger";

/**
 * What an organization is allowed, read from the snapshot the database keeps.
 *
 * THIS IS NOT THE AUTHORITY
 * -------------------------
 * `rpc_create_stand` enforces the Tag cap itself, under a row lock, and that is
 * the only enforcement that counts. Everything here exists so an owner who is
 * already at their limit gets a clear 403 naming the plan instead of a database
 * error, and so the Tags screen can say "3 of 3" without guessing.
 *
 * A check here that disagreed with the database would be a display bug. A
 * database that trusted this check would be a billing hole: two requests can
 * pass this at the same moment, and only the lock stops them both inserting.
 *
 * WHAT A MISSING SNAPSHOT MEANS
 * -----------------------------
 * Trial. Not Starter, not active, and not "whatever the catalog defaults to".
 * An organization with no billing record has not paid for anything, and a
 * resolver that answers "Starter" to the question "what did they buy?" is
 * wrong in the direction that costs money and hides the bug.
 */

function databaseFailure(context: string, error: unknown, requestId: string): never {
  // Logged in full server-side, never returned: a Supabase error carries SQL
  // text, constraint names, and schema details. Local rather than imported
  // from owner-service, which imports this module.
  logger.error("entitlements.database_error", { context, requestId, error });
  throw new ApiError(
    503,
    ERROR_CODE.serviceUnavailable,
    "This service is temporarily unavailable. Please try again shortly.",
  );
}

export type {
  EntitlementStatus,
  PlanId,
} from "@/lib/owner/entitlement-limits";

export interface Entitlement {
  planId: PlanId | null;
  status: EntitlementStatus;
  tagLimit: number;
  locationLimit: number;
  trialStartedAt: string | null;
}

export async function getEntitlement(
  context: AuthenticatedContext,
  orgId: string,
  requestId: string,
): Promise<Entitlement> {
  const { data, error } = await context.db
    .from("entitlement_snapshots")
    .select("plan_id, status, trial_started_at")
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) databaseFailure("entitlement_read", error, requestId);

  // No row: trial. Every organization gets one written at onboarding and the
  // backfill gave one to every organization that predates that, so this is the
  // narrow window between an organization being created by some other path and
  // its first Tag. Answering "trial" is both the safe answer and the true one.
  const row = data as { plan_id?: unknown; status?: unknown; trial_started_at?: unknown } | null;
  const planId: PlanId | null = isPlanId(row?.plan_id) ? row.plan_id : null;
  const status: EntitlementStatus = isEntitlementStatus(row?.status) ? row.status : "trialing";

  return {
    planId,
    status,
    tagLimit: tagLimitOf(planId, status),
    locationLimit: locationLimitOf(planId, status),
    trialStartedAt: typeof row?.trial_started_at === "string" ? row.trial_started_at : null,
  };
}

export async function countLiveTags(
  context: AuthenticatedContext,
  orgId: string,
  requestId: string,
): Promise<number> {
  const { count, error } = await context.db
    .from("review_stands")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .neq("status", "retired");

  if (error) databaseFailure("entitlement_tag_count", error, requestId);
  return count ?? 0;
}

/**
 * The fast 403. Advisory only -- see the note at the top of this file.
 */
export async function assertCanCreateTag(
  context: AuthenticatedContext,
  orgId: string,
  requestId: string,
): Promise<void> {
  const [entitlement, used] = await Promise.all([
    getEntitlement(context, orgId, requestId),
    countLiveTags(context, orgId, requestId),
  ]);

  if (used >= entitlement.tagLimit) {
    throw tagLimitError(entitlement, used);
  }
}

export function tagLimitError(entitlement: Entitlement, used?: number): ApiError {
  const message =
    entitlement.status === "trialing"
      ? "Your trial includes one Tag. Choose a plan to add more."
      : entitlement.status === "active"
        ? "You have used every Tag your plan includes. Upgrade, or retire a Tag you no longer use."
        : "Tags are paused while your subscription is not up to date. Your existing Tags keep working.";

  return new ApiError(403, ERROR_CODE.tagLimitReached, message, {
    details: [
      {
        field: "plan",
        message: `plan=${entitlement.planId ?? "none"} status=${entitlement.status} limit=${entitlement.tagLimit}${
          used === undefined ? "" : ` used=${used}`
        }`,
      },
    ],
  });
}
