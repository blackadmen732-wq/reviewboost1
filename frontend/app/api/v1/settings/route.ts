import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireOrganizationContext } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { isValidGoogleReviewUrl } from "@/lib/server/google-review-url";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { parseOrThrow } from "@/lib/server/validation";

/**
 * Change the business's own details.
 *
 * Until now every one of these was set once during onboarding and then frozen.
 * The Google link mattered most: paste it wrong and every printed code in the
 * building leads nowhere, with no way to fix it short of contacting us. A
 * business that cannot correct its own address is a business that churns.
 *
 * WHY THE GOOGLE URL IS VALIDATED AGAIN HERE
 * ------------------------------------------
 * This value is handed to a customer's browser. An unvalidated one turns the
 * owner's own printed QR code into a phishing lure — and this endpoint is the
 * softest way in, since it needs only a signed-in session rather than physical
 * access to the sticker. The same allowlist as onboarding, applied at every
 * write, with no path that skips it.
 *
 * Everything is optional and applied independently, so changing the business
 * name cannot silently clear the Google link. `exactOptionalPropertyTypes` makes
 * that distinction real in the types rather than a convention.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/settings";

const updateSchema = z
  .strictObject({
    businessName: z.string().trim().min(1, "Give your business a name.").max(160).optional(),
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
      }, "That time zone is not recognised.")
      .optional(),
    locationName: z.string().trim().min(1, "Give this place a name.").max(160).optional(),
    // Empty string clears it, which is different from omitting the field. An
    // owner who pasted the wrong link must be able to remove it without being
    // forced to invent a valid one.
    googleReviewUrl: z
      .string()
      .trim()
      .max(2048)
      .refine(
        (value) => value === "" || isValidGoogleReviewUrl(value),
        "That does not look like a Google review link.",
      )
      .optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Nothing to change.",
  );

export async function PATCH(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    const body = parseOrThrow(updateSchema, await readJsonBody(request));

    if (context.role !== "owner" && context.role !== "admin") {
      throw new ApiError(
        403,
        ERROR_CODE.forbidden,
        "Only the owner can change these settings.",
      );
    }

    if (body.businessName !== undefined || body.timezone !== undefined) {
      const { error } = await context.db.rpc("rpc_update_organization", {
        p_org_id: context.orgId,
        ...(body.businessName !== undefined && { p_name: body.businessName }),
        ...(body.timezone !== undefined && { p_timezone: body.timezone }),
      });

      if (error) {
        if (error.message?.includes("not_found_or_forbidden")) {
          throw new ApiError(403, ERROR_CODE.forbidden, "Only the owner can change these settings.");
        }
        throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
      }
    }

    if (body.locationName !== undefined || body.googleReviewUrl !== undefined) {
      const { data: location, error: locationLookupError } = await context.db
        .from("locations")
        .select("id")
        .eq("org_id", context.orgId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (locationLookupError) {
        throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
      }

      if (!location) {
        throw new ApiError(404, ERROR_CODE.notFound, "You do not have a place set up yet.");
      }

      const { error } = await context.db.rpc("rpc_update_location", {
        p_location_id: location.id,
        ...(body.locationName !== undefined && { p_name: body.locationName }),
        ...(body.googleReviewUrl !== undefined && body.googleReviewUrl !== "" && { p_google_review_url: body.googleReviewUrl }),
        ...(body.googleReviewUrl === "" && { p_clear_google_url: true }),
      });

      if (error) {
        if (error.message?.includes("not_found_or_forbidden")) {
          throw new ApiError(403, ERROR_CODE.forbidden, "Only the owner can change these settings.");
        }
        throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
      }
    }

    return json(request, requestId, 200, { data: { updated: true }, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
