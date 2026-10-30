import type { NextRequest } from "next/server";

import { handle, json, preflight } from "@/lib/server/http";
import { removeCustomerList } from "@/lib/server/customers/list-import";
import { connectionIdOrThrow, consumeRateLimit, requireConnectionsAdmin } from "@/lib/server/integrations/route-helpers";

/** Remove a list: takes back the people only it brought in. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/customers/lists/[importId]/remove";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ importId: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireConnectionsAdmin(request);
    const importId = connectionIdOrThrow((await params).importId);
    await consumeRateLimit("customer_list_remove", context.orgId, 30, 3600);
    const result = await removeCustomerList(context.orgId, context.userId, importId, requestId);
    return json(request, requestId, 200, { data: result, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
