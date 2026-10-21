import type { NextRequest } from "next/server";

import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { authorizeSchema, startAuthorization } from "@/lib/server/integrations/connection-service";
import { consumeRateLimit, requireConnectionsAdmin } from "@/lib/server/integrations/route-helpers";
import { parseOrThrow } from "@/lib/server/validation";

/**
 * Start connecting an app. Returns the provider's sign-in address; the browser
 * goes there next. The single-use state is bound to this user and business.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/connections/providers/[provider]/authorize";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireConnectionsAdmin(request);
    await consumeRateLimit("integration_authorize", context.orgId, 10, 3600);
    const { provider } = await params;
    const body = parseOrThrow(authorizeSchema, await readJsonBody(request));
    const result = await startAuthorization(context, provider, body, requestId);
    return json(request, requestId, 200, { data: result, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
