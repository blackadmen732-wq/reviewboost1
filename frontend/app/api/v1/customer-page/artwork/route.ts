import type { NextRequest } from "next/server";

import { requireOrganizationContext } from "@/lib/server/auth";
import { getCustomerPageArtwork, saveCustomerPageArtwork } from "@/lib/server/customer-page-service";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json, preflight } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/customer-page/artwork";
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 2_000_000;

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async () => {
    const context = await requireOrganizationContext(request);
    const side = request.nextUrl.searchParams.get("side") === "published" ? "published" : "draft";
    const artwork = await getCustomerPageArtwork(context, side);
    if (!artwork) {
      throw new ApiError(404, ERROR_CODE.notFound, "No photo yet.");
    }
    return new Response(new Uint8Array(artwork.bytes), {
      status: 200,
      headers: {
        "Content-Type": artwork.mime,
        "Cache-Control": "no-store",
      },
    });
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    if (context.role !== "owner" && context.role !== "admin") {
      throw new ApiError(403, ERROR_CODE.forbidden, "Only the owner can change the customer page.");
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(400, ERROR_CODE.validationFailed, "Choose a photo.");
    }
    if (!ALLOWED.has(file.type)) {
      throw new ApiError(400, ERROR_CODE.validationFailed, "Use a JPG, PNG, or WebP photo.");
    }
    if (file.size > MAX_BYTES) {
      throw new ApiError(400, ERROR_CODE.validationFailed, "That photo is larger than 2 MB.");
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    await saveCustomerPageArtwork(context, file.type, bytes);
    return json(request, requestId, 200, { data: { uploaded: true }, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
