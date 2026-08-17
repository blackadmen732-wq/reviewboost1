import type { NextRequest } from "next/server";

import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json, preflight } from "@/lib/server/http";
import { rotateStandToken } from "@/lib/server/owner-service";

/**
 * Issue a new token for a stand.
 *
 * **Destructive.** The old token stops resolving the moment this commits, so
 * any QR code already printed and sitting on a table is dead and must be
 * reprinted. That is right for a stand whose token has leaked, and wrong for
 * almost anything else — which is why it is an explicit action rather than a
 * side effect of editing a stand.
 *
 * Not to be confused with rotating the token *digest key*, which migrates every
 * stand without reprinting anything. See docs/backend/ENVIRONMENT.md.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/review-stands/[standId]/rotate-token";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ standId: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner", "admin"]);
    const { standId } = await params;

    if (!UUID.test(standId)) {
      throw new ApiError(400, ERROR_CODE.validationFailed, "The request could not be accepted.", {
        details: [{ field: "standId", message: "Must be a UUID." }],
      });
    }

    const rotated = await rotateStandToken(context, standId, context.orgId, requestId);

    // The new token is returned once. Reprint the stand now — this response is
    // the only place it will ever appear.
    return json(request, requestId, 200, { data: rotated, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
