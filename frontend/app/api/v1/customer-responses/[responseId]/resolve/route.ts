import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { parseOrThrow } from "@/lib/server/validation";

/**
 * Mark a piece of feedback sorted out, or reopen it.
 *
 * Distinct from "read" on purpose. Read means an owner's eyes crossed it;
 * resolved means the business did something. Collapsing the two turns the inbox
 * into a list that empties itself just by being scrolled past, which is exactly
 * how complaints get lost.
 *
 * Reopening exists because people mark things done by accident, and a one-way
 * door makes an owner hesitate before every tap. It is the same endpoint rather
 * than a second one: this sets a state, it does not perform two actions.
 *
 * `resolved_by` travels with `resolved_at` — a database constraint requires both
 * or neither — so "sorted" always has a name attached. Marked-done with nobody
 * attached is how things get marked done without being done.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/customer-responses/[responseId]/resolve";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.strictObject({ resolved: z.boolean() });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ responseId: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireUser(request);
    const { responseId } = await params;

    if (!UUID.test(responseId)) {
      throw new ApiError(400, ERROR_CODE.validationFailed, "The request could not be accepted.", {
        details: [{ field: "responseId", message: "Must be a UUID." }],
      });
    }

    const body = parseOrThrow(bodySchema, await readJsonBody(request));
    const now = new Date().toISOString();

    const { data, error } = await context.db
      .from("customer_responses")
      .update(
        body.resolved
          ? // Resolving implies reading it. Leaving something unread but sorted
            // keeps the badge lit for work that is already finished.
            { resolved_at: now, resolved_by: context.userId, read_at: now }
          : { resolved_at: null, resolved_by: null },
      )
      .eq("id", responseId)
      .select("id, resolved_at")
      .maybeSingle();

    if (error) {
      throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
    }

    // No row means another tenant's, or gone. Both are the same answer here;
    // distinguishing them would confirm that somebody else's feedback exists.
    if (!data) {
      throw new ApiError(404, ERROR_CODE.notFound, "That feedback could not be found.");
    }

    return json(request, requestId, 200, {
      data: { responseId, isResolved: data.resolved_at !== null },
      requestId,
    });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
