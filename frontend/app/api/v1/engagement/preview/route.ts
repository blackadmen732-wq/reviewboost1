import { z } from "zod";
import { requireOrganizationContext } from "@/lib/server/auth";
import { previewMember } from "@/lib/server/engagement/service";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { parseOrThrow } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ROUTE = "/api/v1/engagement/preview";

export async function POST(request: Request): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    const body = parseOrThrow(z.strictObject({ memberId: z.uuid() }), await readJsonBody(request));
    return json(request, requestId, 200, await previewMember(context, body.memberId));
  });
}
export async function OPTIONS(request: Request) { return preflight(request); }
