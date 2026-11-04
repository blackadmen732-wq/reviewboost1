import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireOrganizationContext } from "@/lib/server/auth";
import { DESTINATION_PROVIDERS, isWritableDestinationUrl } from "@/lib/server/destination";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { parseOrThrow, uuidSchema } from "@/lib/server/validation";

/**
 * Change the business's own details.
 *
 * WHY THE DESTINATION IS VALIDATED AGAIN HERE
 * -------------------------------------------
 * The destination is handed to a customer's browser, so an unvalidated one
 * turns the owner's own printed QR code into a phishing lure — and this
 * endpoint is the softest way in, since it needs only a signed-in session
 * rather than physical access to the sticker. The same allowlist as the
 * database applies, at every write, with no path that skips it. The database
 * refuses a bad one regardless; this exists so an owner gets a sentence they
 * can act on instead of a 503.
 *
 * WHY THE LOCATION IS NAMED EXPLICITLY
 * ------------------------------------
 * This endpoint used to change "the oldest location in the organization".
 * With one location that is invisible; with two it silently edits the wrong
 * shop. A location-scoped change now names its location, and the database
 * refuses a location that does not belong to the selected organization.
 *
 * Everything is optional and applied independently, so changing the business
 * name cannot silently clear the destination. `exactOptionalPropertyTypes`
 * makes that distinction real in the types rather than a convention.
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
    locationId: uuidSchema("Choose which place to change.").optional(),
    locationName: z.string().trim().min(1, "Give this place a name.").max(160).optional(),
    destinationProvider: z.enum(DESTINATION_PROVIDERS).optional(),
    // Empty string clears it, which is different from omitting the field. An
    // owner who pasted the wrong link must be able to remove it without being
    // forced to invent a valid one.
    destinationUrl: z.string().trim().max(2048).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to change.")
  .superRefine((value, ctx) => {
    if (value.destinationUrl === undefined) return;
    const provider = value.destinationProvider ?? "google";
    if (value.destinationUrl !== "" && !isWritableDestinationUrl(provider, value.destinationUrl)) {
      ctx.addIssue({
        code: "custom",
        path: ["destinationUrl"],
        message: "That does not look like a review link we can send customers to.",
      });
    }
  });

function serviceUnavailable(): never {
  throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
}

function forbidden(): never {
  throw new ApiError(403, ERROR_CODE.forbidden, "Only the owner can change these settings.");
}

export async function PATCH(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    const body = parseOrThrow(updateSchema, await readJsonBody(request));

    if (context.role !== "owner" && context.role !== "admin") forbidden();

    if (body.businessName !== undefined || body.timezone !== undefined) {
      const { error } = await context.db.rpc("rpc_update_organization", {
        p_org_id: context.orgId,
        ...(body.businessName !== undefined && { p_name: body.businessName }),
        ...(body.timezone !== undefined && { p_timezone: body.timezone }),
      });

      if (error) {
        if (error.message?.includes("not_found_or_forbidden")) forbidden();
        serviceUnavailable();
      }
    }

    const changesLocation =
      body.locationName !== undefined || body.destinationUrl !== undefined;

    if (changesLocation) {
      if (body.locationId === undefined) {
        throw new ApiError(
          400,
          ERROR_CODE.validationFailed,
          "Choose which place to change.",
          { details: [{ field: "locationId", message: "Choose which place to change." }] },
        );
      }

      if (body.locationName !== undefined) {
        const { error } = await context.db.rpc("rpc_update_location", {
          p_location_id: body.locationId,
          p_name: body.locationName,
        });
        if (error) {
          if (error.message?.includes("not_found_or_forbidden")) forbidden();
          serviceUnavailable();
        }
      }

      if (body.destinationUrl !== undefined) {
        // The canonical destination write: it names the organization, so a
        // location belonging to another tenant is refused rather than resolved.
        const { error } = await context.db.rpc("rpc_update_location_destination", {
          p_org_id: context.orgId,
          p_location_id: body.locationId,
          p_provider: body.destinationProvider ?? "google",
          p_url: body.destinationUrl,
        });
        if (error) {
          if (error.message?.includes("not_found_or_forbidden")) forbidden();
          if (
            error.message?.includes("invalid_destination_url") ||
            error.message?.includes("unknown_destination_provider")
          ) {
            throw new ApiError(
              400,
              ERROR_CODE.validationFailed,
              "That does not look like a review link we can send customers to.",
              {
                details: [
                  {
                    field: "destinationUrl",
                    message: "That does not look like a review link we can send customers to.",
                  },
                ],
              },
            );
          }
          serviceUnavailable();
        }
      }
    }

    return json(request, requestId, 200, { data: { updated: true }, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
