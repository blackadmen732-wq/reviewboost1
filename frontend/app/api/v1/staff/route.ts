import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireOrganizationContext } from "@/lib/server/auth";
import { encrypt } from "@/lib/server/crypto";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { parseOrThrow } from "@/lib/server/validation";

/**
 * The team roster.
 *
 * Anyone in the business can add a person, not just the owner. The human who
 * knows the new starter is called Chidi is the shift manager, and a roster only
 * one account can edit is a roster that goes stale — after which every piece of
 * praise sits unmatched and the feature quietly dies.
 *
 * Names are encrypted at rest. This is employee personal data and belongs in the
 * same threat model as the customer note: a stolen database copy must not become
 * a staff list.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/staff";

const createSchema = z.strictObject({
  name: z.string().trim().min(1, "Give this person a name.").max(80),
  // Free text, deliberately not a dropdown. "Kitchen", "Saturday girl", "my
  // son" — small businesses do not have an HR taxonomy, and asking them to pick
  // from one is how a two-field screen becomes a form nobody finishes.
  roleLabel: z.string().trim().max(60).optional(),
});

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    const body = parseOrThrow(createSchema, await readJsonBody(request));

    const { data, error } = await context.db.rpc("rpc_create_staff", {
      p_org_id: context.orgId,
      p_name_encrypted: encrypt(body.name),
      p_role_label: body.roleLabel ?? null,
    });

    if (error) {
      throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
    }

    return json(request, requestId, 201, {
      data: { staffId: data as string, name: body.name },
      requestId,
    });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
