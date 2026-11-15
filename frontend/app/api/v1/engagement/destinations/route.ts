import { z } from "zod";
import { requireOrganizationContext } from "@/lib/server/auth";
import { bindDestination } from "@/lib/server/engagement/adaptive-service";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { parseOrThrow } from "@/lib/server/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ROUTE = "/api/v1/engagement/destinations";
export async function POST(request: Request) {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    const body = parseOrThrow(
      z.strictObject({
        memberId: z.uuid(),
        provider: z.enum(["google_wallet", "webhook"]),
        active: z.boolean(),
      }),
      await readJsonBody(request),
    );
    await bindDestination(context, body.memberId, body.provider, body.active);
    return json(request, requestId, 200, { updated: true });
  });
}
export async function OPTIONS(request: Request) {
  return preflight(request);
}
