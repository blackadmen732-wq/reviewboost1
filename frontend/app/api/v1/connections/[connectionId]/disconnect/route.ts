import type { NextRequest } from "next/server";

import { handle, json, preflight } from "@/lib/server/http";
import { disconnect } from "@/lib/server/integrations/connection-service";
import { connectionIdOrThrow, consumeRateLimit, requireConnectionsAdmin } from "@/lib/server/integrations/route-helpers";

/** Disconnect: stop syncing, revoke access at the app, delete the stored keys. Data is kept 30 days. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/connections/[connectionId]/disconnect";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireConnectionsAdmin(request);
    const connectionId = connectionIdOrThrow((await params).connectionId);
    await consumeRateLimit("integration_disconnect", context.orgId, 20, 3600);
    const result = await disconnect(context, connectionId, requestId);
    return json(request, requestId, 200, { data: result, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
