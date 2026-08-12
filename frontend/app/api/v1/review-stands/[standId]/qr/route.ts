import type { NextRequest } from "next/server";
import QRCode from "qrcode";

import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, preflight } from "@/lib/server/http";
import { getStandTokenForReprint } from "@/lib/server/owner-service";

/**
 * Render a stand's QR code as SVG, so it can be printed or reprinted.
 *
 * SVG rather than PNG because these get printed at whatever size a shop's
 * printer and table tent demand, and a raster scaled up is a QR code that will
 * not scan.
 *
 * Error correction is set to H (~30% recoverable). These end up scuffed,
 * laminated, greasy, and partially covered on a counter — a code that stops
 * working after a month in the field is worse than no code, because nobody
 * notices it stopped.
 *
 * Returns 409 for a stand created before reprinting existed: it has no
 * recoverable token, and the honest answer is "rotate to get a new one", not a
 * broken image.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/review-stands/[standId]/qr";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ standId: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner", "admin"]);
    const { standId } = await params;

    if (!UUID.test(standId)) {
      throw new ApiError(400, ERROR_CODE.validationFailed, "The request could not be accepted.", {
        details: [{ field: "standId", message: "Must be a UUID." }],
      });
    }

    const stand = await getStandTokenForReprint(context, standId, context.orgId, requestId);

    if (stand === null) {
      throw new ApiError(
        409,
        ERROR_CODE.responseConflict,
        "This stand cannot be reprinted. Rotate its token to get a new code.",
      );
    }

    const svg = await QRCode.toString(stand.standUrl, {
      type: "svg",
      errorCorrectionLevel: "H",
      margin: 2,
      color: { dark: "#111827", light: "#FFFFFF" },
    });

    return new Response(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        // Private and uncacheable: this image encodes a capability token, and a
        // shared cache holding it would hand it to the next viewer.
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
        "X-Request-Id": requestId,
        "Content-Disposition": 'inline; filename="reviewboost-stand.svg"',
      },
    });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
