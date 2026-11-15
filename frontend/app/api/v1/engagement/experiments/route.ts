import { z } from "zod";
import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import {
  campaignSchema,
  readAdaptiveReport,
} from "@/lib/server/engagement/adaptive-service";
import { engagementFailure } from "@/lib/server/engagement/service";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { parseOrThrow } from "@/lib/server/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ROUTE = "/api/v1/engagement/experiments";

export async function GET(request: Request) {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    return json(request, requestId, 200, await readAdaptiveReport(context));
  });
}
export async function POST(request: Request) {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner", "admin"]);
    const body = parseOrThrow(
      z.strictObject({ campaign: campaignSchema, active: z.boolean() }),
      await readJsonBody(request),
    );
    const { data, error } = await context.db.rpc(
      "rpc_set_engagement_experiment",
      {
        p_org_id: context.orgId,
        p_campaign: body.campaign,
        p_active: body.active,
      },
    );
    if (error || !data) engagementFailure(error);
    return json(request, requestId, 200, { id: data });
  });
}
export async function OPTIONS(request: Request) {
  return preflight(request);
}
