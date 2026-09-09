import type { NextRequest } from "next/server";

import { getPublicHero } from "@/lib/server/customer-page-service";
import { handle, preflight } from "@/lib/server/http";
import { reviewLinkInactive } from "@/lib/server/errors";
import { parseTokenOrThrow } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/public/q/[token]/artwork";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async () => {
    const { token } = await params;
    const validToken = parseTokenOrThrow(token);
    const artwork = await getPublicHero(validToken);
    if (!artwork) throw reviewLinkInactive();
    return new Response(new Uint8Array(artwork.bytes), {
      status: 200,
      headers: {
        "Content-Type": artwork.mime,
        "Cache-Control": "no-store",
      },
    });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
