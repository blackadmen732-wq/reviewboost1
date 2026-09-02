import type { NextRequest } from "next/server";

import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json, preflight } from "@/lib/server/http";
import { cancelTextRequest } from "@/lib/server/sms/text-request-service";

/**
 * Cancel a Text Request that has not yet been dispatched.
 *
 * A cancel that arrives too late — the message is already sending or settled —
 * returns a clean 409 rather than pretending it worked.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/text-requests/[requestId]/cancel";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (reqId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner", "admin"]);

    const { requestId: textRequestId } = await params;
    if (!UUID_RE.test(textRequestId)) {
      throw new ApiError(404, ERROR_CODE.notFound, "Not found.");
    }

    const cancelled = await cancelTextRequest(context, textRequestId, reqId);
    if (!cancelled) {
      throw new ApiError(409, ERROR_CODE.responseConflict, "This Text Request can no longer be cancelled.");
    }

    return json(request, reqId, 200, { data: { requestId: textRequestId, status: "cancelled" }, requestId: reqId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
