import type { NextRequest } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { handle, json, preflight } from "@/lib/server/http";
import { listStands } from "@/lib/server/owner-service";

/**
 * The owner's stands.
 *
 * Returns a short non-secret token prefix, never the token. The token is shown
 * exactly once, when the stand is created or its token is rotated, because only
 * a keyed digest is stored — there is no query that could recover it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/review-stands";

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireUser(request);
    const stands = await listStands(context, requestId);
    return json(request, requestId, 200, { data: stands, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
