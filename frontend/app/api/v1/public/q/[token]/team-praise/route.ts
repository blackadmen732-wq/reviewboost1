import type { NextRequest } from "next/server";

import { handle, preflight } from "@/lib/server/http";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";

/**
 * POST /api/v1/public/q/{token}/team-praise — V1 tombstone.
 *
 * Team Praise is not active in V1. Returns 410 Gone so clients that call this
 * know the feature was deliberately removed, not temporarily unavailable.
 * Historical team_praise_records rows are unaffected.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/public/q/[token]/team-praise";

export async function POST(
  request: NextRequest,
  _ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (_requestId) => {
    throw new ApiError(410, ERROR_CODE.gone, "Team Praise is no longer active.");
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
