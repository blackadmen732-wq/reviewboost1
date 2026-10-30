import { after, type NextRequest } from "next/server";

import { handle, json, preflight } from "@/lib/server/http";
import { activate } from "@/lib/server/integrations/connection-service";
import { connectionIdOrThrow, consumeRateLimit, requireConnectionsAdmin } from "@/lib/server/integrations/route-helpers";
import { processIntegrations } from "@/lib/server/integrations/sync-runner";

/** Turn on. Only after a passing check of the current settings; the first read starts right away. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/connections/[connectionId]/activate";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireConnectionsAdmin(request);
    const connectionId = connectionIdOrThrow((await params).connectionId);
    await consumeRateLimit("integration_activate", context.orgId, 20, 3600);
    const result = await activate(context, connectionId, requestId);
    after(() => processIntegrations({ budgetMs: 25_000 }).then(() => undefined, () => undefined));
    return json(request, requestId, 200, { data: result, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
