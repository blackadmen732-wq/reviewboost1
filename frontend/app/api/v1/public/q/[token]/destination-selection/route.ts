import type { NextRequest } from "next/server";

import { recordDestinationSelection } from "@/lib/server/customer-flow-service";
import { handle, noContent, preflight, readJsonBody } from "@/lib/server/http";
import { requestMetaOf } from "@/lib/server/request-meta";
import {
  destinationSelectionSchema,
  parseIdempotencyKeyOrThrow,
  parseOrThrow,
  parseTokenOrThrow,
} from "@/lib/server/validation";

/**
 * POST /api/v1/public/q/{token}/destination-selection — record the handoff.
 *
 * Records that the customer was handed to the business's configured public
 * review destination, and which provider that was. That is the entire claim. It
 * does not mean a review was written, submitted, or published, and no metric
 * built on it may imply otherwise — ReviewBoost cannot see what a customer does
 * once they arrive.
 *
 * Never redirects. The client owns the navigation, so a failure here can never
 * stand between a customer and the public review page.
 *
 * 204 on a first record and on a replay alike: the contract documents one
 * success status for this operation.
 */

// The customer page now sends the whole tap to /ratings, which records exactly
// this step among the others. This route stays for pages that were already
// open when that shipped.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/public/q/[token]/destination-selection";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const { token } = await params;
    const validToken = parseTokenOrThrow(token);
    const idempotencyKey = parseIdempotencyKeyOrThrow(request);
    const body = parseOrThrow(destinationSelectionSchema, await readJsonBody(request));

    await recordDestinationSelection(
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
