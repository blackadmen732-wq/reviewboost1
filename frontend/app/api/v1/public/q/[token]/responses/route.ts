import type { NextRequest } from "next/server";

import { submitResponse } from "@/lib/server/customer-flow-service";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { requestMetaOf } from "@/lib/server/request-meta";
import {
  parseIdempotencyKeyOrThrow,
  parseOrThrow,
  parseTokenOrThrow,
  submitResponseSchema,
} from "@/lib/server/validation";

/**
 * POST /api/v1/public/q/{token}/responses — store the rating.
 *
 * REVIEW INTEGRITY: every rating from 1 to 5 is handled identically here. There
 * is no threshold, no branch on the value, and no rating-dependent action in
 * the response. The Google opportunity was already delivered by the context
 * endpoint, before any rating existed.
 *
 * V1 CONTRACT: the rating is the whole submission. There is no note field —
 * `submitResponseSchema` is strict, so a client that still sends one is told
 * the request was rejected rather than having the text silently dropped.
 *
 * The strictness is the same protection against a phone number, email address,
 * or marketing consent flag: rejected rather than ignored, because an endpoint
 * that quietly discarded them would still be one someone could be told to
 * start using.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/public/q/[token]/responses";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const { token } = await params;
    const validToken = parseTokenOrThrow(token);
    const idempotencyKey = parseIdempotencyKeyOrThrow(request);
    const body = parseOrThrow(submitResponseSchema, await readJsonBody(request));

    const result = await submitResponse(
      validToken,
      {
        sessionId: body.sessionId,
        rating: body.rating,
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
