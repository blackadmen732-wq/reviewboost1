import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireOrganizationContext } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import {
  getCustomerPageState,
  publishCustomerPage,
  saveCustomerPageDraft,
} from "@/lib/server/customer-page-service";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { parseOrThrow } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/customer-page";

const draftSchema = z.strictObject({
  transform: z.strictObject({
    x: z.number(),
    y: z.number(),
    scale: z.number(),
  }),
  tagline: z.string().trim().max(80).optional(),
  publish: z.boolean().optional(),
});

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    const state = await getCustomerPageState(context);
    return json(request, requestId, 200, { data: state, requestId });
  });
}

export async function PATCH(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    if (context.role !== "owner" && context.role !== "admin") {
      throw new ApiError(403, ERROR_CODE.forbidden, "Only the owner can change the customer page.");
    }
    const body = parseOrThrow(draftSchema, await readJsonBody(request));
    await saveCustomerPageDraft(context, {
      transform: body.transform,
      tagline: body.tagline ?? null,
    });
    if (body.publish) await publishCustomerPage(context);
    const state = await getCustomerPageState(context);
    return json(request, requestId, 200, { data: state, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
