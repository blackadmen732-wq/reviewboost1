import type { NextRequest } from "next/server";

import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { callbackSchema, completeAuthorization } from "@/lib/server/integrations/connection-service";
import { consumeRateLimit, requireConnectionsAdmin } from "@/lib/server/integrations/route-helpers";
import { parseOrThrow } from "@/lib/server/validation";

/**
 * Finish connecting an app. The callback page posts what the provider handed
 * back (state and code, or an error); the code is exchanged here, server side,
 * and the tokens never reach the browser.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/connections/providers/[provider]/callback";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireConnectionsAdmin(request);
    await consumeRateLimit("integration_callback", context.orgId, 20, 3600);
    const { provider } = await params;
    const body = parseOrThrow(callbackSchema, await readJsonBody(request));
    const result = await completeAuthorization(context, provider, body, requestId);
    return json(request, requestId, 200, { data: result, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
