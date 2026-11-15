import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import { prepareEngagement } from "@/lib/server/engagement/adaptive-service";
import { handle, json, preflight } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ROUTE = "/api/v1/engagement/run";
export async function POST(request: Request) {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner", "admin"]);
    return json(
      request,
      requestId,
      200,
      await prepareEngagement(context.db, context.orgId),
    );
  });
}
export async function OPTIONS(request: Request) {
  return preflight(request);
}
