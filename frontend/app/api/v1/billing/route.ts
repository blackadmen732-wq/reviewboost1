import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import {
  createCheckoutSession,
  createPortalSession,
  readBillingState,
} from "@/lib/server/billing-service";
import { PLAN_IDS } from "@/lib/server/entitlements";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { parseOrThrow } from "@/lib/server/validation";

/**
 * Billing, from the owner's side.
 *
 * GET returns what the backend believes, and only that: the plan, the status,
 * the trial end, the period end, and the real SMS balances. The UI renders
 * this or renders nothing — it never fills a gap with "Starter", "trialing",
 * "150", or a next invoice date it invented.
 *
 * POST starts either a checkout or a portal session. Neither grants anything:
 * a plan changes when Stripe says so, through the webhook.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/billing";

const actionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("checkout"), planId: z.enum(PLAN_IDS) }),
  z.strictObject({ action: z.literal("portal") }),
]);

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    const state = await readBillingState(context, context.orgId, requestId);
    return json(request, requestId, 200, { data: state, requestId });
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner"]);

    const body = parseOrThrow(actionSchema, await readJsonBody(request));

    const session =
      body.action === "checkout"
        ? await createCheckoutSession(context, context.orgId, body.planId, requestId)
        : await createPortalSession(context.orgId, requestId);

    return json(request, requestId, 200, { data: session, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
