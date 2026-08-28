import type { NextRequest } from "next/server";

import { requireOrganizationContext } from "@/lib/server/auth";
import { handle, json, preflight } from "@/lib/server/http";
import { listLiveFeed } from "@/lib/server/owner-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/live-feed";

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    const url = new URL(request.url);

    const limitParam = url.searchParams.get("limit");
    const parsedLimit = limitParam === null ? undefined : Number(limitParam);
    const cursor = url.searchParams.get("cursor") ?? undefined;

    const page = await listLiveFeed(
      context,
      { cursor, limit: parsedLimit },
      requestId,
      context.orgId,
    );

    return json(request, requestId, 200, { ...page, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
