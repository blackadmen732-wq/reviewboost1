import type { NextRequest } from "next/server";
import { z } from "zod";

import { type AuthenticatedContext, requireOrganizationContext } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
import { stripeClient } from "@/lib/server/stripe";
import { serviceRoleClient } from "@/lib/server/supabase";
import { parseOrThrow } from "@/lib/server/validation";

/**
 * Delete the business account.
 *
 * WHY THIS EXISTS
 * ---------------
 * Deleting used to mean emailing privacy@reviewboost.fit. Apple's 5.1.1(v)
 * requires an app that creates accounts to let a person begin deleting one
 * from inside it, so the mailto was a submission blocker — but the better
 * reason is that a person who wants their data gone should not have to ask a
 * human for it and then wait to be believed.
 *
 * IDENTITY IS NEVER AN ARGUMENT
 * -----------------------------
 * This endpoint takes no email, no user id and no account identifier. The
 * actor is the session, the organization comes from the normal org-context
 * resolution that RLS then re-checks, and `rpc_delete_organization` reads
 * `auth.uid()` for itself. There is deliberately no shape of this request in
 * which one person names another and deletes their business.
 *
 * The typed confirmation is not identity either — it is deliberateness, and
 * the database checks it too. A confirmation enforced only by a form is a
 * convention; enforced in the function it is a property.
 *
 * STRIPE GOES FIRST, AND A FAILURE THERE STOPS EVERYTHING
 * -------------------------------------------------------
 * The subscription is cancelled before the row holding its id is destroyed,
 * because the worst available outcome here is a business that keeps being
 * charged for an account that no longer exists. If Stripe cannot be reached,
 * nothing is deleted and the caller is told to cancel from Billing first. That
 * is a worse experience than proceeding and a much better failure.
 *
 * Invoices are not deleted. Money that has moved is a record both sides are
 * required to keep, and /delete-account says so rather than implying Stripe
 * forgets too.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/account/deletion";

const bodySchema = z.strictObject({
  confirmation: z
    .string()
    .trim()
    .min(1, "Type your business name to confirm.")
    .max(160),
});

/**
 * Stripe statuses that still represent a live billing relationship.
 *
 * Listed as the set that must be cancelled rather than the set that may be
 * skipped: a status Stripe adds later should land on the cautious side and be
 * cancelled, not silently left running.
 */
const SETTLED_STRIPE_STATUSES = new Set(["canceled", "cancelled", "incomplete_expired"]);

interface BillingRefs {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_status: string | null;
}

export function OPTIONS(request: NextRequest): Response {
  return preflight(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);

    // Owner only, and checked here as well as in the function so the caller
    // gets a sentence instead of the deliberately vague not_found the database
    // raises for every unauthorised case.
    if (context.role !== "owner") {
      throw new ApiError(
        403,
        ERROR_CODE.forbidden,
        "Only an owner can delete the business account.",
      );
    }

    const { confirmation } = parseOrThrow(bodySchema, await readJsonBody(request));

    // The name and the owner check run in the database before Stripe is
    // touched. Cancelling is irreversible; a rejected confirmation after it
    // used to leave the business with all its data and no paid plan.
    const check = await context.db.rpc("rpc_delete_organization_check", {
      p_org_id: context.orgId,
      p_confirmation: confirmation,
    });
    if (check.error) throwDeletionRefusal(check.error, requestId);

    await cancelBillingBeforeDeleting(context.orgId, requestId);

    const { data, error } = await context.db.rpc("rpc_delete_organization", {
      p_org_id: context.orgId,
      p_confirmation: confirmation,
    });

    if (error) throwDeletionRefusal(error, requestId);

    const signInRemoved = await removeSignInIfLastAccount(context, requestId);

    logger.info("account.deleted", { requestId, signInRemoved });

    return json(request, requestId, 200, {
      data: {
        removed: data ?? {},
        // The client uses this to decide between "signed out for good" and
        // "still signed in, now showing your other business".
        signInRemoved,
      },
    });
  });
}

/** The database's refusals, as the caller should hear them. */
function throwDeletionRefusal(error: { message?: string }, requestId: string): never {
  const message = error.message ?? "";
  if (message.includes("confirmation_mismatch")) {
    throw new ApiError(400, ERROR_CODE.validationFailed, "That is not the business name.", {
      details: [{ field: "confirmation", message: "Type the business name exactly as it appears." }],
    });
  }
  if (message.includes("not_found_or_forbidden")) {
    throw new ApiError(404, ERROR_CODE.notFound, "Not found.");
  }
  logger.error("account.delete_failed", { requestId, error: message });
  throw new ApiError(500, ERROR_CODE.internalError, "Something went wrong on our side.");
}

/**
 * Cancel the subscription, or refuse to continue.
 *
 * Reads the Stripe ids through a service-role `public.rpc_*` function rather
 * than a table query, keeping `billing_customers` unreadable by members. It is
 * `public` because the Data API serves nothing else: the earlier
 * call into the `app` schema failed on every request.
 */
async function cancelBillingBeforeDeleting(orgId: string, requestId: string): Promise<void> {
  let refs: BillingRefs | null = null;

  try {
    const { data, error } = await serviceRoleClient().rpc("rpc_billing_refs_for_org", {
      p_org_id: orgId,
    });
    if (error) throw new Error(error.message);
    refs = (Array.isArray(data) ? data[0] : data) ?? null;
  } catch (error) {
    logger.error("account.billing_lookup_failed", { requestId, error });
    throw new ApiError(
      503,
      ERROR_CODE.serviceUnavailable,
      "We could not check your subscription, so nothing has been deleted. Try again shortly.",
    );
  }

  const subscriptionId = refs?.stripe_subscription_id;
  // A business that never subscribed, and one whose subscription Stripe has
  // already finished with, both have nothing to cancel.
  if (!subscriptionId) return;
  if (refs?.stripe_status && SETTLED_STRIPE_STATUSES.has(refs.stripe_status)) return;

  try {
    await stripeClient().subscriptions.cancel(subscriptionId);
  } catch (error) {
    // `resource_missing` means Stripe does not have it, which is the state we
    // wanted anyway. Anything else stops the deletion.
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "resource_missing"
    ) {
      logger.warn("account.subscription_already_gone", { requestId });
      return;
    }

    logger.error("account.cancel_failed", { requestId, error });
    throw new ApiError(
      503,
      ERROR_CODE.serviceUnavailable,
      "We could not cancel your subscription, so nothing has been deleted. Cancel from Billing first, then delete.",
    );
  }
}

/**
 * Remove the login too, but only if it now belongs to nothing.
 *
 * Someone who owns two businesses and deletes one still has an account. The
 * query runs as the caller, so it sees their own memberships and nobody
 * else's; an error is treated as "they might still have one", because leaving
 * a login in place is recoverable and removing one that was still in use is
 * not.
 *
 * This is the one place the service-role client does something other than call
 * an `app.*` function. Deleting a row from `auth.users` is not possible any
 * other way — Supabase owns that schema — and the Auth Admin API takes exactly
 * one user id, so the blast radius is the same as a definer function's.
 */
async function removeSignInIfLastAccount(
  context: AuthenticatedContext,
  requestId: string,
): Promise<boolean> {
  const { data, error } = await context.db
    .from("organization_members")
    .select("org_id")
    .eq("user_id", context.userId)
    .eq("status", "active")
    .limit(1);

  if (error) {
    logger.warn("account.membership_recheck_failed", { requestId, error: error.message });
    return false;
  }

  if (Array.isArray(data) && data.length > 0) return false;

  const { error: deleteError } = await serviceRoleClient().auth.admin.deleteUser(context.userId);

  if (deleteError) {
    // The business and its data are already gone, which is what was asked for.
    // A login that can no longer reach anything is a loose end for support, not
    // a reason to tell someone their deletion failed.
    logger.error("account.sign_in_delete_failed", { requestId, error: deleteError.message });
    return false;
  }

  return true;
}
