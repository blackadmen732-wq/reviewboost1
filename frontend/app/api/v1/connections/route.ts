import type { NextRequest } from "next/server";

import { handle, json, preflight } from "@/lib/server/http";
import { listConnections } from "@/lib/server/integrations/connection-service";
import { requireConnectionsAdmin } from "@/lib/server/integrations/route-helpers";

/** This business's live connections. Read through the caller's own RLS. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/connections";

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireConnectionsAdmin(request);
    const connections = await listConnections(context.db, context.orgId, requestId);
    return json(request, requestId, 200, { data: connections, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
