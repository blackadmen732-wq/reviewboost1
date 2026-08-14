import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireOrganizationContext } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { parseOrThrow } from "@/lib/server/validation";

/**
 * Match a piece of praise to a real person, and record that it was passed on.
 *
 * MATCHING IS A HUMAN DECISION AND STAYS ONE
 * ------------------------------------------
 * A customer types a first name from memory, on a phone, after a meal.
 * "Amara", "amara", "Amira". Guessing which colleague was meant — and then
 * showing that guess as fact — credits somebody for work they did not do and
 * quietly overlooks somebody who did. So this endpoint records a decision the
 * owner made; it never infers one.
 *
 * PASSING IT ON HAPPENS OUT LOUD, NOT IN THIS APP
 * -----------------------------------------------
 * Staff have no accounts here, and giving them one to receive a notification
 * would turn a two-minute setup into a staff-onboarding project that no café
 * will finish. Telling someone they were praised takes four seconds in a
 * kitchen; the value this adds is remembering that it happened, so the same
 * praise is not passed on twice or — much more likely — never.
 *
 * `matched_at`/`matched_staff_id` and `shared_at`/`shared_by` are each bound by
 * a CHECK constraint, so neither can end up half-written.
 *
 * The rating is never read or written here. `team_praise_records` has no rating
 * column and this handler performs no join to `customer_responses`, so the star
 * is not available to influence who gets recognised.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/team-praise/[praiseId]";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const updateSchema = z
  .strictObject({
    // null unmatches — an owner who picked the wrong Sam must be able to undo
    // it without the record being stuck wrong forever.
    staffId: z.string().uuid().nullable().optional(),
    shared: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to change.");

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ praiseId: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    const { praiseId } = await params;

    if (!UUID.test(praiseId)) {
      throw new ApiError(400, ERROR_CODE.validationFailed, "The request could not be accepted.", {
        details: [{ field: "praiseId", message: "Must be a UUID." }],
      });
    }

    const body = parseOrThrow(updateSchema, await readJsonBody(request));
    let resultStatus: string | null = null;

    if (body.staffId !== undefined) {
      if (body.staffId === null) {
        const { error } = await context.db.rpc("rpc_unmatch_praise", {
          p_praise_id: praiseId,
        });
        if (error) {
          if (error.message?.includes("not_found_or_forbidden")) {
            throw new ApiError(404, ERROR_CODE.notFound, "We could not find that praise.");
          }
          throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
        }
        resultStatus = "unmatched";
      } else {
        const { error } = await context.db.rpc("rpc_match_praise", {
          p_praise_id: praiseId,
          p_staff_id: body.staffId,
        });
        if (error) {
          if (error.message?.includes("invalid_staff_member")) {
            throw new ApiError(404, ERROR_CODE.notFound, "We could not find that person.");
          }
          if (error.message?.includes("not_found_or_forbidden")) {
            throw new ApiError(404, ERROR_CODE.notFound, "We could not find that praise.");
          }
          throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
        }
        resultStatus = "matched";
      }
    }

    if (body.shared !== undefined) {
      const rpcName = body.shared ? "rpc_mark_praise_shared" : "rpc_unmark_praise_shared";
      const { error } = await context.db.rpc(rpcName, {
        p_praise_id: praiseId,
      });
      if (error && !error.message?.includes("not_found_or_forbidden")) {
        throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
      }
    }

    if (body.archived !== undefined) {
      const rpcName = body.archived ? "rpc_archive_praise" : "rpc_restore_praise";
      const { error } = await context.db.rpc(rpcName, {
        p_praise_id: praiseId,
      });
      if (error && !error.message?.includes("not_found_or_forbidden")) {
        throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
      }
      resultStatus = body.archived ? "archived" : "unmatched";
    }

    if (resultStatus === null) {
      const { data: current, error: statusError } = await context.db
        .from("praise_safe_view")
        .select("status")
        .eq("id", praiseId)
        .eq("org_id", context.orgId)
        .maybeSingle();
      if (statusError) {
        throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
      }
      resultStatus = (current?.status as string) ?? "unmatched";
    }

    return json(request, requestId, 200, {
      data: { praiseId, status: resultStatus },
      requestId,
    });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
