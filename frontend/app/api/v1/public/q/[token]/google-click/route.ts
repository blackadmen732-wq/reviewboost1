import type { NextRequest } from "next/server";

import { recordGoogleClick } from "@/lib/server/customer-flow-service";
import { handle, noContent, preflight, readJsonBody } from "@/lib/server/http";
import { requestMetaOf } from "@/lib/server/request-meta";
import {
  googleClickSchema,
  parseIdempotencyKeyOrThrow,
  parseOrThrow,
  parseTokenOrThrow,
} from "@/lib/server/validation";

/**
 * POST /api/v1/public/q/{token}/google-click — record the selection.
 *
 * Records that the customer *selected* the Google action. That is the entire
 * claim. It does not mean a review was written, submitted, or published, and no
 * metric built on it may imply otherwise — ReviewBoost cannot see what a
 * customer does once they reach Google.
 *
 * Never redirects. The client owns the navigation, so a failure here can never
 * stand between a customer and the public review page.
 *
 * 204 on a first record and on a replay alike: the contract documents one
 * success status for this operation.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/public/q/[token]/google-click";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const { token } = await params;
    const validToken = parseTokenOrThrow(token);
    const idempotencyKey = parseIdempotencyKeyOrThrow(request);
    const body = parseOrThrow(googleClickSchema, await readJsonBody(request));

    await recordGoogleClick(
      validToken,
      { sessionId: body.sessionId, responseId: body.responseId, idempotencyKey },
      requestMetaOf(request, requestId),
    );

    return noContent(request, requestId);
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
