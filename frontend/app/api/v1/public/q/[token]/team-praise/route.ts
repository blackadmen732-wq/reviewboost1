import type { NextRequest } from "next/server";

import { json, preflight } from "@/lib/server/http";

/**
 * POST /api/v1/public/q/{token}/team-praise — removed in V1.
 *
 * Team Praise is not active in V1. Historical records in the database are
 * preserved. This route returns 410 Gone so any client that still calls it
 * receives a clear, intentional signal rather than a 404 (which would imply
 * the path was never valid).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/public/q/[token]/team-praise";

export async function POST(request: NextRequest): Promise<Response> {
  return json(request, crypto.randomUUID(), 410, {
    error: { code: "gone", message: "Team Praise is not active in V1." },
    requestId: crypto.randomUUID(),
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
