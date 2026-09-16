import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import {
  ASSET_CONTENT_TYPES,
  ASSET_KINDS,
  beginAssetUpload,
  confirmAssetUpload,
} from "@/lib/server/customer-page-service";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { parseOrThrow, uuidSchema } from "@/lib/server/validation";

/**
 * Customer Page images, in two steps.
 *
 * POST mints a signed upload for one path the caller does not choose — built
 * from the organization id, so one business cannot write into another's
 * prefix — and records the asset as `pending`.
 *
 * PUT confirms it by looking at storage: the object has to exist, be an image,
 * and be within the size limit. Only then is the asset publishable. The
 * browser's word that it finished uploading is not evidence, and a page that
 * could be published pointing at bytes that never arrived would show a broken
 * image to every customer who scanned.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/customer-page/assets";

const beginSchema = z.strictObject({
  kind: z.enum(ASSET_KINDS),
  contentType: z.enum(ASSET_CONTENT_TYPES),
});

const confirmSchema = z.strictObject({
  assetId: uuidSchema("That image is not one of yours."),
  path: z.string().min(1).max(400),
});

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner", "admin"]);

    const body = parseOrThrow(beginSchema, await readJsonBody(request));
    const ticket = await beginAssetUpload(
      context,
      context.orgId,
      body.kind,
      body.contentType,
      requestId,
    );

    return json(request, requestId, 201, { data: ticket, requestId });
  });
}

export async function PUT(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner", "admin"]);

    const body = parseOrThrow(confirmSchema, await readJsonBody(request));

    // The path is re-derived from the caller's own organization rather than
    // trusted: a path naming another tenant's prefix is refused here, before
    // storage is ever asked about it.
    if (!body.path.startsWith(`org/${context.orgId}/`)) {
      const { ApiError, ERROR_CODE } = await import("@/lib/server/errors");
      throw new ApiError(403, ERROR_CODE.forbidden, "That image is not one of yours.");
    }

    const confirmed = await confirmAssetUpload(
      context,
      context.orgId,
      body.assetId,
      body.path,
      requestId,
    );

    return json(request, requestId, 200, { data: confirmed, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
