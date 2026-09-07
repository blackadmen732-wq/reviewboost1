import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireOrganizationContext } from "@/lib/server/auth";
import {
  CUSTOMER_PAGE_TEMPLATES,
  getCustomerPageProfile,
  patchCustomerPageDraft,
} from "@/lib/server/customer-page-service";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { parseOrThrow } from "@/lib/server/validation";

/**
 * Owner-scoped customer page draft.
 *
 * GET returns the draft, the last-published snapshot, and the publish
 * metadata for the organization's default profile — or for the location
 * override when `locationId` is present.
 *
 * PATCH replaces the draft. The publish snapshot is untouched; publishing
 * is a separate call, so an incremental save cannot ship a half-edited
 * page to customers.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/customer-page";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const heroSchema = z
  .strictObject({
    assetId: z.union([z.string().regex(UUID_RE), z.null()]).optional(),
    focalX: z.number().min(0).max(1).optional(),
    focalY: z.number().min(0).max(1).optional(),
    zoom: z.number().min(1).max(1.5).optional(),
  })
  .optional();

const logoSchema = z
  .strictObject({
    assetId: z.union([z.string().regex(UUID_RE), z.null()]).optional(),
  })
  .optional();

const patchSchema = z.strictObject({
  locationId: z.string().regex(UUID_RE).optional(),
  composerVersion: z.number().int().min(1).max(255).default(1),
  draft: z.strictObject({
    templateId: z.enum(CUSTOMER_PAGE_TEMPLATES).optional(),
    hero: heroSchema,
    logo: logoSchema,
  }),
});

function requireEditor(role: string): void {
  if (role !== "owner" && role !== "admin") {
    throw new ApiError(
      403,
      ERROR_CODE.forbidden,
      "Only the owner or an admin can edit the customer page.",
    );
  }
}

function readLocationId(request: NextRequest): string | null {
  const value = new URL(request.url).searchParams.get("locationId");
  if (!value) return null;
  if (!UUID_RE.test(value)) {
    throw new ApiError(400, ERROR_CODE.validationFailed, "Invalid location identifier.");
  }
  return value;
}

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireEditor(context.role);
    const locationId = readLocationId(request);
    const profile = await getCustomerPageProfile(context, context.orgId, locationId, requestId);
    return json(request, requestId, 200, profile);
  });
}

export async function PATCH(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireEditor(context.role);
    const body = parseOrThrow(patchSchema, await readJsonBody(request));
    const profile = await patchCustomerPageDraft(
      context,
      context.orgId,
      body.locationId ?? null,
      body.draft,
      body.composerVersion,
      requestId,
    );
    return json(request, requestId, 200, profile);
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
