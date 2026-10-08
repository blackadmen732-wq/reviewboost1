import type { NextRequest } from "next/server";

import { submitRating } from "@/lib/server/customer-flow-service";
import { handle, noContent, preflight, readJsonBody } from "@/lib/server/http";
import { requestMetaOf } from "@/lib/server/request-meta";
import {
  parseIdempotencyKeyOrThrow,
  parseOrThrow,
  parseTokenOrThrow,
  submitRatingSchema,
} from "@/lib/server/validation";

/**
 * POST /api/v1/public/q/{token}/ratings — the whole tap in one request.
 *
 * V1 contract: Tag/QR/NFC → tap a star → the business's public review
 * destination opens in the same moment, and this request records the scan,
 * the rating (1–5) and the handoff alongside it. The page sends it with
 * `keepalive`, so it completes after the page has gone.
 *
 * REVIEW INTEGRITY: every rating from 1 to 5 is handled identically here: the
 * same steps, the same status, the same (empty) body. The destination was
 * delivered by the context endpoint before any rating existed.
 *
 * Never redirects. 204 on a first record and on a replay alike.
 *
 * The request schema is strict, so a phone number, email address, note, or
 * marketing consent flag is rejected rather than ignored.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/public/q/[token]/ratings";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const { token } = await params;
    const validToken = parseTokenOrThrow(token);
    const idempotencyKey = parseIdempotencyKeyOrThrow(request);
    const body = parseOrThrow(submitRatingSchema, await readJsonBody(request));

    await submitRating(
      validToken,
      { locale: body.locale, rating: body.rating, idempotencyKey },
      requestMetaOf(request, requestId),
    );

    return noContent(request, requestId);
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
