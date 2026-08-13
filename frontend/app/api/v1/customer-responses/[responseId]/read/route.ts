import type { NextRequest } from "next/server";

import { requireOrganizationContext } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json, preflight } from "@/lib/server/http";

/**
 * Mark one piece of feedback as read.
 *
 * Without this the unread badge only ever grows, and a counter that never goes
 * down stops being information — it becomes wallpaper, and then a genuinely
 * urgent complaint looks exactly like the forty before it.
 *
 * Idempotent by nature: marking something read twice is the same as once, so no
 * Idempotency-Key is required. Runs under the caller's own client, so RLS
 * refuses another tenant's row without this handler checking anything.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/customer-responses/[responseId]/read";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ responseId: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    const { responseId } = await params;

    if (!UUID.test(responseId)) {
      throw new ApiError(400, ERROR_CODE.validationFailed, "The request could not be accepted.", {
        details: [{ field: "responseId", message: "Must be a UUID." }],
      });
    }

    const { error } = await context.db.rpc("rpc_mark_response_read", {
      p_response_id: responseId,
    });

    if (error && !error.message?.includes("not_found_or_forbidden")) {
      throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
    }

    return json(request, requestId, 200, { data: { responseId, isRead: true, changed: !error }, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
