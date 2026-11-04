import type { NextRequest } from "next/server";

import { handle, json, preflight } from "@/lib/server/http";
import { runTest } from "@/lib/server/integrations/connection-service";
import { connectionIdOrThrow, consumeRateLimit, requireConnectionsAdmin } from "@/lib/server/integrations/route-helpers";

/** Run the check: read a small recent sample from the app and report counts. Saves nothing else. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/connections/[connectionId]/test";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireConnectionsAdmin(request);
    const connectionId = connectionIdOrThrow((await params).connectionId);
    await consumeRateLimit("integration_read_provider", context.orgId, 60, 3600);
    const result = await runTest(context, connectionId, requestId);
    return json(request, requestId, 200, { data: result, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
