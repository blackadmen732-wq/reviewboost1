import type { NextRequest } from "next/server";
import { z } from "zod";

import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { requestMetaOf } from "@/lib/server/request-meta";
import { REVIEW_CODE_PATTERN, reviewSignIn, reviewSignInConfig } from "@/lib/server/review-sign-in";
import { parseOrThrow } from "@/lib/server/validation";

/**
 * POST /api/v1/public/review-sign-in — App Review's sign-in.
 *
 * Anonymous, because the person calling it is not signed in yet. Off unless
 * REVIEW_SIGN_IN_EMAIL and REVIEW_SIGN_IN_CODE are set on the server; see
 * `lib/server/review-sign-in.ts` for how it is kept to one account and why it
 * cannot be guessed.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/public/review-sign-in";

const bodySchema = z.strictObject({
  email: z.string().trim().min(3).max(320),
  code: z.string().trim().regex(REVIEW_CODE_PATTERN, "Enter the six-digit code."),
});

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const config = reviewSignInConfig();
    // Off looks like nothing is here, not like a door that says "closed".
    if (!config) throw new ApiError(404, ERROR_CODE.notFound, "Not found.");

    const input = parseOrThrow(bodySchema, await readJsonBody(request));
    const { address } = requestMetaOf(request, requestId);
    const result = await reviewSignIn(config, input, address, requestId);

    return json(request, requestId, 200, { data: result, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
