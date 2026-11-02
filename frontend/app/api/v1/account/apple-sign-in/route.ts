import type { NextRequest } from "next/server";
import { z } from "zod";

import { appleBundleId, keepAppleTokenFromCode } from "@/lib/server/apple-sign-in";
import { requireUser } from "@/lib/server/auth";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { parseOrThrow } from "@/lib/server/validation";

/**
 * Keep what is needed to revoke Sign in with Apple at account deletion.
 *
 * The iPhone app signs in with Apple natively, then posts the one-time
 * authorization code Apple gave it. The server exchanges that code with Apple
 * (it needs our private key, which never leaves the server) and keeps the
 * refresh token, encrypted, only so account deletion can revoke it, as Apple
 * requires (lib/server/apple-sign-in.ts).
 *
 * The person is the session's person; identity is never an argument. The
 * answer says only whether a token is now kept. A failure here never undoes
 * the sign-in, which has already happened.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/account/apple-sign-in";

const bodySchema = z.strictObject({
  authorizationCode: z.string().trim().min(10).max(2048),
});

export function OPTIONS(request: NextRequest): Response {
  return preflight(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireUser(request);
    const { authorizationCode } = parseOrThrow(bodySchema, await readJsonBody(request, { maxBytes: 4096 }));
    const kept = await keepAppleTokenFromCode(context.userId, authorizationCode, appleBundleId(), requestId);
    return json(request, requestId, 200, { data: { kept } });
  });
}
