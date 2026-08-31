import type { NextRequest } from "next/server";
import QRCode from "qrcode";

import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json as jsonResponse, preflight } from "@/lib/server/http";
import { getStandTokenForReprint } from "@/lib/server/owner-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/review-stands/[standId]/qr";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_FORMATS = new Set(["svg", "png", "json"]);
const MIN_PNG_SIZE = 150;
const MAX_PNG_SIZE = 2048;
const DEFAULT_PNG_SIZE = 512;

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

    const url = new URL(request.url);
    const format = url.searchParams.get("format") ?? "svg";
    if (!ALLOWED_FORMATS.has(format)) {
      throw new ApiError(400, ERROR_CODE.validationFailed, "The request could not be accepted.", {
        details: [{ field: "format", message: "Must be svg, png, or json." }],
      });
    }

    let pngSize = DEFAULT_PNG_SIZE;
    if (format === "png") {
      const sizeParam = url.searchParams.get("size");
      if (sizeParam !== null) {
        const parsed = Number(sizeParam);
        if (!Number.isFinite(parsed) || parsed < MIN_PNG_SIZE || parsed > MAX_PNG_SIZE) {
          throw new ApiError(400, ERROR_CODE.validationFailed, "The request could not be accepted.", {
            details: [{ field: "size", message: `Must be between ${MIN_PNG_SIZE} and ${MAX_PNG_SIZE}.` }],
          });
        }
        pngSize = Math.round(parsed);
      }
    }

    const stand = await getStandTokenForReprint(context, standId, context.orgId, requestId);

    if (stand === null) {
      throw new ApiError(
        409,
        ERROR_CODE.responseConflict,
        "This stand cannot be reprinted. Rotate its token to get a new code.",
      );
    }

    if (format === "json") {
      return jsonResponse(request, requestId, 200, {
        data: { standUrl: stand.standUrl, label: stand.label },
        requestId,
      });
    }

    const qrOptions = {
      errorCorrectionLevel: "H" as const,
      margin: 2,
      color: { dark: "#111827", light: "#FFFFFF" },
    };

    if (format === "png") {
      const pngBuffer = await QRCode.toBuffer(stand.standUrl, {
        ...qrOptions,
        type: "png",
        width: pngSize,
      });

      return new Response(new Uint8Array(pngBuffer), {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "no-store, private",
          "X-Content-Type-Options": "nosniff",
          "X-Request-Id": requestId,
          "Content-Disposition": `attachment; filename="reviewboost-stand-${pngSize}px.png"`,
        },
      });
    }

    const svg = await QRCode.toString(stand.standUrl, {
      ...qrOptions,
      type: "svg",
    });

    return new Response(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
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
