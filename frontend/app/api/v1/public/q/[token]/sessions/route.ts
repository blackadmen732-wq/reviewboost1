import type { NextRequest } from "next/server";

import { createSession } from "@/lib/server/customer-flow-service";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { requestMetaOf } from "@/lib/server/request-meta";
import {
  createSessionSchema,
  parseIdempotencyKeyOrThrow,
  parseOrThrow,
  parseTokenOrThrow,
} from "@/lib/server/validation";

/**
 * POST /api/v1/public/q/{token}/sessions — start an anonymous session.
 *
 * 201 when created, 200 when an identical request is replayed: a replay created
 * nothing, so reporting 201 again would be a lie the client can act on.
 *
 * Records one logical scan. The scan lives here rather than on the GET so that
 * loading the page never inflates a business's numbers.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/public/q/[token]/sessions";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const { token } = await params;
    const validToken = parseTokenOrThrow(token);
    const idempotencyKey = parseIdempotencyKeyOrThrow(request);
    const body = parseOrThrow(createSessionSchema, await readJsonBody(request));

    const result = await createSession(
      validToken,
      { locale: body.locale, idempotencyKey },
      requestMetaOf(request, requestId),
    );

    return json(request, requestId, result.status, result.body);
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
