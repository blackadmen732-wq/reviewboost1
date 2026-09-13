import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireOrganizationContext } from "@/lib/server/auth";
import { createCustomerPageAssetUpload } from "@/lib/server/customer-page-service";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { parseOrThrow } from "@/lib/server/validation";

/**
 * Create a new asset upload reservation.
 *
 * Returns a (currently null) signed-upload URL and the asset id. The
 * actual signed URL depends on storage-provider configuration that is not
 * wired yet; the contract is stable so the client can be built against it
 * now and uploads will start working the moment the storage bucket is
 * live.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/customer-page/upload";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const bodySchema = z.strictObject({
  locationId: z.string().regex(UUID_RE).optional(),
  kind: z.enum(["hero", "logo"]),
  contentType: z.enum(ACCEPTED_TYPES),
});

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    if (context.role !== "owner" && context.role !== "admin") {
      throw new ApiError(
        403,
        ERROR_CODE.forbidden,
        "Only the owner or an admin can upload images.",
      );
    }
    const body = parseOrThrow(bodySchema, await readJsonBody(request));
    const result = await createCustomerPageAssetUpload(
      context,
      context.orgId,
      body.locationId ?? null,
      body.kind,
      body.contentType,
      requestId,
    );
    return json(request, requestId, 201, result);
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
