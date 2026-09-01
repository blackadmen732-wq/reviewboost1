import type { NextRequest } from "next/server";

import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, noContent, preflight } from "@/lib/server/http";
import { recordNfcProvision } from "@/lib/server/owner-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/review-stands/[standId]/nfc-provision";

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

    await recordNfcProvision(
      context,
      standId,
      context.orgId,
      requestId,
    );

    return noContent(request, requestId);
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
