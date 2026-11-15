import { z } from "zod";
import { withdrawLoyalty } from "@/lib/server/engagement/service";
import { handle, noContent, preflight, readJsonBody } from "@/lib/server/http";
import { requestMetaOf } from "@/lib/server/request-meta";
import { parseOrThrow, tokenSchema } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ROUTE = "/api/v1/public/loyalty/withdraw";

export async function POST(request: Request): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const body = parseOrThrow(z.strictObject({ memberToken: tokenSchema }), await readJsonBody(request));
    await withdrawLoyalty(body.memberToken, requestMetaOf(request, requestId));
    return noContent(request, requestId);
  });
}
export async function OPTIONS(request: Request) { return preflight(request); }
