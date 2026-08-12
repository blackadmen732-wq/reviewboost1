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

    const { data, error } = await context.db
      .from("customer_responses")
      .update({ read_at: new Date().toISOString() })
      .eq("id", responseId)
      .eq("org_id", context.orgId)
      .is("read_at", null)
      .select("id")
      .maybeSingle();

    if (error) {
      throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
    }

    // No row means it belongs to another tenant, does not exist, or was already
    // read. All three are a no-op from the caller's point of view, and telling
    // them apart would leak which responses exist.
    return json(request, requestId, 200, { data: { responseId, isRead: true, changed: Boolean(data) }, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
