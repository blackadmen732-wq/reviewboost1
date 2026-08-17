import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/server/auth";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { createOrganization, getOnboardingState } from "@/lib/server/owner-service";
import { SUPPORTED_LOCALES, parseOrThrow } from "@/lib/server/validation";

/**
 * Owner onboarding.
 *
 * GET derives progress from real records rather than stored booleans — a
 * duplicate flag drifts from reality the moment anything changes outside the
 * wizard, and then the owner is trapped being told to do something they have
 * already done.
 *
 * POST creates the organization, the owner membership, the first location, and
 * the first stand in one database transaction, so a failure cannot leave a user
 * owning nothing or an organization with no owner.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/onboarding";

const createSchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  // Lowercase, hyphenated, and bounded: it becomes part of a public URL.
  slug: z
    .string()
    .trim()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/, "Use lowercase letters, numbers, and hyphens."),
  timezone: z
    .string()
    .max(60)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "Must be a valid IANA time zone."),
  defaultLocale: z.enum(SUPPORTED_LOCALES),
  locationName: z.string().trim().min(1).max(160),
  googleReviewUrl: z.string().trim().max(2048).optional(),
  standLabel: z.string().trim().min(1).max(80).optional(),
});

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireUser(request);
    const state = await getOnboardingState(context, requestId);
    return json(request, requestId, 200, { data: state, requestId });
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireUser(request);
    const body = parseOrThrow(createSchema, await readJsonBody(request));

    const created = await createOrganization(
      context,
      {
        name: body.name,
        slug: body.slug,
        timezone: body.timezone,
        defaultLocale: body.defaultLocale,
        locationName: body.locationName,
        googleReviewUrl: body.googleReviewUrl,
        standLabel: body.standLabel,
      },
      requestId,
    );

    // standToken is returned exactly once. Only its digest is stored, so this
    // response is the only moment it exists in readable form.
    return json(request, requestId, 201, { data: created, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
