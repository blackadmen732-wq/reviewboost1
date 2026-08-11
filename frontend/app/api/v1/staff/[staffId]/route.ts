import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/server/auth";
import { encrypt } from "@/lib/server/crypto";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { parseOrThrow } from "@/lib/server/validation";

/**
 * Correct a name, or mark that somebody has left.
 *
 * There is no DELETE, and the database grants none. Someone who leaves is
 * deactivated, never removed — deleting them would silently rewrite the praise
 * they earned, and an owner would lose the record of good work that genuinely
 * happened. Staff turnover in this industry is high; the history is the point.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/staff/[staffId]";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const updateSchema = z
  .strictObject({
    name: z.string().trim().min(1, "Give this person a name.").max(80).optional(),
    // Empty string clears the label, which is different from omitting it.
    roleLabel: z.string().trim().max(60).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to change.");

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ staffId: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireUser(request);
    const { staffId } = await params;

    if (!UUID.test(staffId)) {
      throw new ApiError(400, ERROR_CODE.validationFailed, "The request could not be accepted.", {
        details: [{ field: "staffId", message: "Must be a UUID." }],
      });
    }

    const body = parseOrThrow(updateSchema, await readJsonBody(request));

    const changes: Record<string, string | boolean | null> = {};
    if (body.name !== undefined) changes.name_encrypted = encrypt(body.name);
    if (body.roleLabel !== undefined) changes.role_label = body.roleLabel === "" ? null : body.roleLabel;
    if (body.isActive !== undefined) changes.is_active = body.isActive;

    // RLS scopes this to the caller's organization, so no org filter is needed
    // and a missing one returns fewer rows rather than somebody else's.
    const { data, error } = await context.db
      .from("staff_members")
      .update(changes)
      .eq("id", staffId)
      .select("id")
      .maybeSingle();

    if (error) {
      throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
    }

    if (!data) {
      throw new ApiError(404, ERROR_CODE.notFound, "We could not find that person.");
    }

    return json(request, requestId, 200, { data: { staffId }, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
