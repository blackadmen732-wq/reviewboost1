import type { NextRequest } from "next/server";

import { requireOrganizationContext } from "@/lib/server/auth";
import { getEntitlementSnapshot } from "@/lib/server/entitlements-service";
import { handle, json, preflight } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/entitlements";

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    const snapshot = await getEntitlementSnapshot(context, context.orgId);
    return json(request, requestId, 200, { data: snapshot, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
