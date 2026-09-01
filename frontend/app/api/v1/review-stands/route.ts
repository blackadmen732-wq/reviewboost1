import type { NextRequest } from "next/server";

import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { createStand, listStands } from "@/lib/server/owner-service";

/**
 * The owner's stands.
 *
 * GET returns a short non-secret token prefix, never the token.
 * POST creates a new stand under a specific location (owner/admin only).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/review-stands";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    const stands = await listStands(context, requestId, context.orgId);
    return json(request, requestId, 200, { data: stands, requestId });
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner", "admin"]);

    const body = await readJsonBody(request);
    const { locationId, label } = body as Record<string, unknown>;

    if (typeof locationId !== "string" || !UUID.test(locationId)) {
      throw new ApiError(400, ERROR_CODE.validationFailed, "The request could not be accepted.", {
        details: [{ field: "locationId", message: "Must be a valid UUID." }],
      });
    }

    if (label !== undefined && typeof label !== "string") {
      throw new ApiError(400, ERROR_CODE.validationFailed, "The request could not be accepted.", {
        details: [{ field: "label", message: "Must be a string." }],
      });
    }

    const trimmedLabel = typeof label === "string" ? label.trim() : "";
    if (trimmedLabel.length > 100) {
      throw new ApiError(400, ERROR_CODE.validationFailed, "The request could not be accepted.", {
        details: [{ field: "label", message: "Must be 100 characters or fewer." }],
      });
    }

    const created = await createStand(context, context.orgId, locationId, trimmedLabel, requestId);

    return json(request, requestId, 201, { data: created, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
