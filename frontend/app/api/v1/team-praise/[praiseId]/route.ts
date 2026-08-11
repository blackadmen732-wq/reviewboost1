import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/server/auth";
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
    const context = await requireUser(request);
    const { praiseId } = await params;

    if (!UUID.test(praiseId)) {
      throw new ApiError(400, ERROR_CODE.validationFailed, "The request could not be accepted.", {
        details: [{ field: "praiseId", message: "Must be a UUID." }],
      });
    }

    const body = parseOrThrow(updateSchema, await readJsonBody(request));
    const now = new Date().toISOString();
    const changes: Record<string, string | null> = {};

    if (body.staffId !== undefined) {
      if (body.staffId === null) {
        changes.matched_staff_id = null;
        changes.matched_at = null;
        changes.matched_by_user_id = null;
        changes.status = "unmatched";
      } else {
        // Checked explicitly rather than left to the foreign key. The composite
        // FK carrying org_id would refuse a cross-tenant staff id anyway, but it
        // would surface as an opaque 503 — and "we could not find that person"
        // is the answer an owner can act on.
        const { data: staff, error: staffError } = await context.db
          .from("staff_members")
          .select("id")
          .eq("id", body.staffId)
          .maybeSingle();

        if (staffError) {
          throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
        }

        if (!staff) {
          throw new ApiError(404, ERROR_CODE.notFound, "We could not find that person.");
        }

        changes.matched_staff_id = body.staffId;
        changes.matched_at = now;
        changes.matched_by_user_id = context.userId;
        changes.status = "matched";
      }
    }

    if (body.shared !== undefined) {
      changes.shared_at = body.shared ? now : null;
      changes.shared_by = body.shared ? context.userId : null;
    }

    if (body.archived !== undefined) {
      // Archiving is for praise that is not usable — a customer naming the
      // business itself, or typing nonsense. It never deletes: the customer
      // said it, and the record of what was said is not ours to erase.
      changes.status = body.archived
        ? "archived"
        : changes.status !== undefined
          ? changes.status
          : "unmatched";
    }

    const { data, error } = await context.db
      .from("team_praise_records")
      .update(changes)
      .eq("id", praiseId)
      .select("id, status")
      .maybeSingle();

    if (error) {
      throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
    }

    if (!data) {
      throw new ApiError(404, ERROR_CODE.notFound, "We could not find that praise.");
    }

    return json(request, requestId, 200, {
      data: { praiseId, status: data.status as string },
      requestId,
    });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
