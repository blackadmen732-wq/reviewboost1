import type { NextRequest } from "next/server";

import { handle, json, preflight } from "@/lib/server/http";
import { getConnection, listMappings } from "@/lib/server/integrations/connection-service";
import { connectionIdOrThrow, requireConnectionsAdmin } from "@/lib/server/integrations/route-helpers";

/** One connection: its state, health, last check and chosen places. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/connections/[connectionId]";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireConnectionsAdmin(request);
    const connectionId = connectionIdOrThrow((await params).connectionId);
    const connection = await getConnection(context.db, context.orgId, connectionId, requestId);
    const mappings = await listMappings(context.db, connectionId, requestId);
    return json(request, requestId, 200, { data: { ...connection, mappings }, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
