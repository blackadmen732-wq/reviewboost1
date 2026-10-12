import type { NextRequest } from "next/server";

import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { parseOrThrow } from "@/lib/server/validation";
import { previewSchema, previewTextRequest } from "@/lib/server/sms/text-request-service";

/**
 * Segment and cost preview for a Text Request, before anything is scheduled.
 *
 * Read-only: it returns the exact message (business name and "Reply STOP" line
 * included), its encoding and segment count, the estimated cost at the
 * configured provider rate, and whether this number may be texted. It records
 * nothing and reserves nothing.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/text-requests/preview";

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner", "admin"]);

    const body = parseOrThrow(previewSchema, await readJsonBody(request));
    const preview = await previewTextRequest(context, body, requestId);

    return json(request, requestId, 200, { data: preview, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
