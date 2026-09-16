import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import { readEntitlement, locationLimit } from "@/lib/server/entitlements";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { createLocation } from "@/lib/server/owner-service";
import { listLocations } from "@/lib/server/owner-data";
import { parseOrThrow } from "@/lib/server/validation";

/**
 * The organization's places.
 *
 * GET reports what exists and what the plan allows, so the owner UI can say
 * "2 of 2" rather than guessing or hardcoding a number.
 *
 * POST adds one. The cap is enforced by the database inside the create
 * transaction; this endpoint checks first only so the refusal is a sentence
 * instead of an exception.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/locations";

const createSchema = z.strictObject({
  name: z.string().trim().min(1, "Give this place a name.").max(160),
});

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    const [locations, entitlement] = await Promise.all([
      listLocations(context.orgId),
      readEntitlement(context, context.orgId, requestId),
    ]);

    return json(request, requestId, 200, {
      data: {
        locations,
        used: locations.length,
        limit: locationLimit(entitlement.planId, entitlement.status),
      },
      requestId,
    });
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner", "admin"]);

    const body = parseOrThrow(createSchema, await readJsonBody(request));
    const created = await createLocation(context, context.orgId, body.name, requestId);

    return json(request, requestId, 201, { data: created, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
