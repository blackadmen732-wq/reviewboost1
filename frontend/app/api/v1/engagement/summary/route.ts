import { requireOrganizationContext } from "@/lib/server/auth";
import { engagementFailure } from "@/lib/server/engagement/service";
import { handle, json } from "@/lib/server/http";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handle(request, "/api/v1/engagement/summary", async (requestId) => {
    const context = await requireOrganizationContext(request);
    const now = Date.now();
    const raw = new URL(request.url).searchParams.get("since");
    const since = raw === null ? now - 30 * 86_400_000 : Date.parse(raw);
    if (!Number.isFinite(since) || since > now || since < now - 365 * 86_400_000)
      throw new ApiError(400, ERROR_CODE.validationFailed, "Choose a date within the past year.");
    const { data, error } = await context.db.rpc("rpc_engagement_summary", {
      p_org_id: context.orgId, p_since: new Date(since).toISOString(),
    });
    if (error || !data) engagementFailure(error);
    return json(request, requestId, 200, { since: new Date(since).toISOString(), ...data });
  });
}
