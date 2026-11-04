import type { NextRequest } from "next/server";

import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { importCustomerList, listImportSchema, MAX_LIST_BODY_BYTES } from "@/lib/server/customers/list-import";
import { consumeRateLimit, requireConnectionsAdmin } from "@/lib/server/integrations/route-helpers";
import { parseOrThrow } from "@/lib/server/validation";

/**
 * Bring in a customer list (a Google Sheet the owner picked). The browser
 * sends the rows; no Google credential reaches this route. Importing never
 * records consent to text anyone.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/customers/lists";

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireConnectionsAdmin(request);
    await consumeRateLimit("customer_list_import", context.orgId, 20, 3600);
    const body = parseOrThrow(listImportSchema, await readJsonBody(request, { maxBytes: MAX_LIST_BODY_BYTES }));
    const result = await importCustomerList(context.orgId, context.userId, body, requestId);
    return json(request, requestId, 201, { data: result, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
