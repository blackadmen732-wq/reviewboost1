import type { NextRequest } from "next/server";

import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json, preflight } from "@/lib/server/http";
import { recordNfcProvision } from "@/lib/server/owner-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/review-stands/[standId]/nfc-provision";

/**
 * POST — record that a physical NFC tag was written for this stand.
 *
 * Answers with the record rather than 204. The server cannot know whether the
 * write to the tag succeeded -- that happened on the phone, through Web NFC --
 * but it can be exact about the one thing it owns: whether the write was
 * recorded here. A 204 could not distinguish that from a failure, and a client
 * that ignores the result (which today's does -- a client bug, tracked
 * separately) would then show a tag as provisioned that the server has no
 * record of.
 *
 * A retry after a partial success -- tag written, network dropped -- is this
 * same request again. The RPC is idempotent, so nobody has to rewrite a tag
 * that is already correct.
 */

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

    const record = await recordNfcProvision(
      context,
      standId,
      context.orgId,
      requestId,
    );

    return json(request, requestId, 200, { data: record, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
