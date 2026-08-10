import type { NextRequest } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { handle, json, preflight } from "@/lib/server/http";
import { listCustomerResponses } from "@/lib/server/owner-service";

/**
 * The private feedback workspace.
 *
 * Shows the rating, because this is the one place an owner is meant to see it.
 * Team Praise deliberately does not — see that route.
 *
 * Cursor-paginated. Offset pagination degrades as the table grows and silently
 * skips or repeats rows when new feedback arrives mid-scroll, which for a
 * feedback inbox means an owner never seeing a complaint.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/customer-responses";

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireUser(request);
    const url = new URL(request.url);

    const limitParam = url.searchParams.get("limit");
    const parsedLimit = limitParam === null ? undefined : Number(limitParam);
    const cursor = url.searchParams.get("cursor") ?? undefined;

    const page = await listCustomerResponses(
      context,
      {
        cursor,
        limit: Number.isFinite(parsedLimit) ? (parsedLimit as number) : 25,
      },
      requestId,
    );

    return json(request, requestId, 200, { ...page, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
