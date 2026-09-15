import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import {
  MAX_TAGLINE_LENGTH,
  PAGE_TEMPLATES,
  publishCustomerPage,
  readCustomerPage,
  saveCustomerPageDraft,
  unpublishCustomerPage,
} from "@/lib/server/customer-page-service";
import { handle, json, noContent, preflight, readJsonBody } from "@/lib/server/http";
import { parseOrThrow, uuidSchema } from "@/lib/server/validation";

/**
 * The owner's Customer Page.
 *
 * GET returns the draft and the published snapshot separately, so the editor
 * can show "what you are editing" and "what customers see right now" as two
 * different things rather than one ambiguous state.
 *
 * PUT saves the draft. POST publishes it. DELETE takes it down without
 * discarding the work.
 *
 * `locationId` is optional and means what it says: omitted edits the
 * organization's page, present edits that one place's override. It is never
 * inferred from "the first location".
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/customer-page";

const scopeSchema = z.strictObject({
  locationId: uuidSchema("Choose which place this page is for.").nullish(),
});

const draftSchema = scopeSchema.extend({
  templateId: z.enum(PAGE_TEMPLATES).optional(),
  tagline: z.string().trim().max(MAX_TAGLINE_LENGTH).nullish(),
  logoAssetId: uuidSchema("That image is not one of yours.").nullish(),
  heroAssetId: uuidSchema("That image is not one of yours.").nullish(),
});

function locationFrom(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get("locationId");
}

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    const locationId = locationFrom(request);
    const page = await readCustomerPage(context, context.orgId, locationId, requestId);
    return json(request, requestId, 200, { data: page, requestId });
  });
}

export async function PUT(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner", "admin"]);

    const body = parseOrThrow(draftSchema, await readJsonBody(request));
    const { locationId, ...draft } = body;

    await saveCustomerPageDraft(
      context,
      context.orgId,
      locationId ?? null,
      draft,
      requestId,
    );

    return json(request, requestId, 200, { data: { saved: true }, requestId });
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner", "admin"]);

    const body = parseOrThrow(scopeSchema, await readJsonBody(request));
    const published = await publishCustomerPage(
      context,
      context.orgId,
      body.locationId ?? null,
      requestId,
    );

    return json(request, requestId, 200, { data: published, requestId });
  });
}

export async function DELETE(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner", "admin"]);

    await unpublishCustomerPage(context, context.orgId, locationFrom(request), requestId);
    return noContent(request, requestId);
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
