import type { NextRequest } from "next/server";

import { handle, json, preflight } from "@/lib/server/http";
import { providerDirectory } from "@/lib/server/integrations/connection-service";
import { requireConnectionsAdmin } from "@/lib/server/integrations/route-helpers";

/** The Connections directory: which apps exist and whether each can be connected here. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/connections/providers";

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    await requireConnectionsAdmin(request);
    return json(request, requestId, 200, { data: providerDirectory(), requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
