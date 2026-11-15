import { z } from "zod";
import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import { engagementFailure, memberDigests } from "@/lib/server/engagement/service";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { parseOrThrow, tokenSchema } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ROUTE = "/api/v1/loyalty/transactions";
const schema = z.strictObject({
  memberToken: tokenSchema, kind: z.enum(["earn", "redeem"]),
  purchaseReference: z.string().trim().min(1).max(120),
});

export async function POST(request: Request): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner", "admin", "member"]);
    const body = parseOrThrow(schema, await readJsonBody(request));
    const { data, error } = await context.db.rpc("rpc_loyalty_transaction", {
      p_org_id: context.orgId, ...memberDigests(body.memberToken), p_kind: body.kind,
      p_purchase_reference: body.purchaseReference,
    });
    if (error || !data) engagementFailure(error);
    return json(request, requestId, 200, data);
  });
}
export async function OPTIONS(request: Request) { return preflight(request); }
