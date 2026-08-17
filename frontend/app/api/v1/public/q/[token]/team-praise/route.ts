import type { NextRequest } from "next/server";

import { submitTeamPraise } from "@/lib/server/customer-flow-service";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { requestMetaOf } from "@/lib/server/request-meta";
import {
  parseIdempotencyKeyOrThrow,
  parseOrThrow,
  parseTokenOrThrow,
  teamPraiseSchema,
} from "@/lib/server/validation";

/**
 * POST /api/v1/public/q/{token}/team-praise — praise a colleague.
 *
 * Stored unmatched, with the name and note encrypted at rest. ReviewBoost never
 * guesses which colleague the customer meant: matching is a decision a human
 * makes later, with the rating deliberately out of view.
 *
 * The response carries only the new id. No rating, no Google state, no bonus,
 * payroll, phone, email, or marketing field — `team_praise_records` has no
 * rating column at all, so the barrier holds in the schema rather than in a
 * query someone has to remember to trim.
 *
 * Accepted after every rating, including a 1. Praise and a complaint are not
 * mutually exclusive, and the product must not assume they are.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/public/q/[token]/team-praise";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const { token } = await params;
    const validToken = parseTokenOrThrow(token);
    const idempotencyKey = parseIdempotencyKeyOrThrow(request);
    const body = parseOrThrow(teamPraiseSchema, await readJsonBody(request));

    const result = await submitTeamPraise(
      validToken,
      {
        sessionId: body.sessionId,
        responseId: body.responseId,
        firstName: body.firstName,
        ...(body.note === undefined ? {} : { note: body.note }),
        idempotencyKey,
      },
      requestMetaOf(request, requestId),
    );

    return json(request, requestId, result.status, result.body);
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
