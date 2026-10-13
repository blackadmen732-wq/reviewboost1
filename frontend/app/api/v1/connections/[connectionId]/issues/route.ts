import type { NextRequest } from "next/server";

import { handle, json, preflight } from "@/lib/server/http";
import { getConnection, listOpenIssues } from "@/lib/server/integrations/connection-service";
import { connectionIdOrThrow, requireConnectionsAdmin } from "@/lib/server/integrations/route-helpers";

/** Records that could not be brought in, with a hint that never shows a whole number. Read through the caller's own RLS. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/connections/[connectionId]/issues";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireConnectionsAdmin(request);
    const connectionId = connectionIdOrThrow((await params).connectionId);
    await getConnection(context.db, context.orgId, connectionId, requestId);
    const items = await listOpenIssues(context.db, connectionId, requestId);
    return json(request, requestId, 200, { data: items, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
