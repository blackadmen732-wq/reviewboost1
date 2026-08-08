import type { NextRequest } from "next/server";

import { getContext } from "@/lib/server/customer-flow-service";
import { handle, json, preflight } from "@/lib/server/http";
import { requestMetaOf } from "@/lib/server/request-meta";
import { parseTokenOrThrow } from "@/lib/server/validation";

/**
 * GET /api/v1/public/q/{token} — public review context.
 *
 * Anonymous by design. The stand token in the URL is a capability: it
 * authorises reading the presentation for exactly one business and nothing
 * else. No cookie, no CSRF token, and no Authorization header is read, so an
 * owner scanning their own code while signed in to the dashboard is unaffected.
 *
 * Read-only. A GET never records a scan, so a link preview, a crawler, or a
 * refresh cannot inflate a business's numbers.
 *
 * Returns no organization id, location id, or stand id — a caller who learned
 * the tenant could write unlimited fabricated feedback into it.
 */

// node:crypto is used for encryption and keyed digests below this handler.
export const runtime = "nodejs";
// The response depends on the token and on live data, so it must never be
// statically rendered or cached.
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/public/q/[token]";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const { token } = await params;
    const validToken = parseTokenOrThrow(token);

    const context = await getContext(validToken, requestMetaOf(request, requestId));

    return json(request, requestId, 200, context);
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
