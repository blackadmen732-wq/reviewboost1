import type { NextRequest } from "next/server";
import { z } from "zod";

import { type AuthenticatedContext, requireUser } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";
import { parseOrThrow } from "@/lib/server/validation";

/**
 * Delete your own login.
 *
 * WHY THIS IS SEPARATE FROM /account/deletion
 * -------------------------------------------
 * That route deletes a business, and only its owner may. A team member, or
 * someone who signed in and never created a business, still has an account of
 * their own and Apple 5.1.1(v) asks that they can delete it from inside the
 * app. "Ask an owner to remove you" removes access and keeps the login, which
 * is not the same thing. (docs/design/PR67_LAUNCH_GAPS.md, L1.)
 *
 * IDENTITY IS NEVER AN ARGUMENT
 * -----------------------------
 * No email, no user id. The person deleted is the session's person. Needs no
 * business context either, so someone with no business can reach it.
 *
 * WHAT HAPPENS
 * ------------
 *   * Refused, with the names, while the caller is the only active owner of a
 *     business: deleting them would leave a business nobody can run or delete.
 *     They delete that business first, through the typed, Stripe-cancelling
 *     path, which removes the login too when it was their last.
 *   * Otherwise the login is removed with the Auth Admin API. Memberships and
 *     the profile cascade; notes they wrote on ratings stay with the business
 *     with no author (migration 20261018000100).
 *
 * The check changes nothing, and the delete is one call, so a retry after a
 * lost response either deletes or finds the session already gone (401). There
 * is no half-deleted state to reconcile.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/account/personal-deletion";

/** The word typed to confirm. Not identity: deliberateness. */
const PERSONAL_DELETION_WORD = "delete";

const bodySchema = z.strictObject({
  confirmation: z.string().trim().min(1, "Type delete to confirm.").max(40),
});

interface Blocker {
  orgId: string;
  name: string;
}

export function OPTIONS(request: NextRequest): Response {
  return preflight(request);
}

/** Whether the caller may delete their login now, and if not, why. */
export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireUser(request);
    const blockers = await soleOwnedBusinesses(context, requestId);
    return json(request, requestId, 200, { data: { allowed: blockers.length === 0, blockers } });
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireUser(request);
    const { confirmation } = parseOrThrow(bodySchema, await readJsonBody(request));

    if (confirmation.toLowerCase() !== PERSONAL_DELETION_WORD) {
      throw new ApiError(400, ERROR_CODE.validationFailed, "Type delete to confirm.", {
        details: [{ field: "confirmation", message: "Type the word delete." }],
      });
    }

    // Check and leave every team in one locked step, so two co-owners
    // deleting at once cannot both go (rpc_prepare_my_account_deletion).
    const blockers = await soleOwnedBusinesses(context, requestId, "rpc_prepare_my_account_deletion");
    if (blockers.length > 0) {
      throw new ApiError(409, ERROR_CODE.ownsBusiness, ownsBusinessMessage(blockers), {
        details: blockers.map((blocker) => ({ field: "business", message: blocker.name })),
      });
    }

    const { error } = await serviceRoleClient().auth.admin.deleteUser(context.userId);
    if (error) {
      // They have already left their teams; a retry finds no memberships and
      // only has the login left to delete.
      logger.error("account.personal_delete_failed", { requestId, error: error.message });
      throw new ApiError(
        503,
        ERROR_CODE.serviceUnavailable,
        "You've been removed from your businesses, but your sign-in wasn't deleted yet. Try again.",
      );
    }

    logger.info("account.personal_deleted", { requestId });
    return json(request, requestId, 200, { data: { deleted: true } });
  });
}

/**
 * Read as the caller, so `auth.uid()` in the function is the session's person.
 * A failed read refuses rather than proceeding: deleting the last owner of a
 * business by mistake cannot be undone, waiting a minute can.
 */
async function soleOwnedBusinesses(
  context: AuthenticatedContext,
  requestId: string,
  fn: "rpc_my_account_deletion_blockers" | "rpc_prepare_my_account_deletion" = "rpc_my_account_deletion_blockers",
): Promise<Blocker[]> {
  const { data, error } = await context.db.rpc(fn);
  if (error) {
    logger.error("account.personal_blockers_failed", { requestId, error: error.message });
    throw new ApiError(
      503,
      ERROR_CODE.serviceUnavailable,
      "We could not check your businesses, so nothing was deleted. Try again shortly.",
    );
  }
  return ((data ?? []) as Array<{ org_id: string; name: string }>).map((row) => ({
    orgId: row.org_id,
    name: row.name,
  }));
}

function ownsBusinessMessage(blockers: Blocker[]): string {
  const names = blockers.map((blocker) => blocker.name);
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `You're the only owner of ${list}. Delete ${names.length === 1 ? "that business" : "those businesses"} first, then delete your account.`;
}
