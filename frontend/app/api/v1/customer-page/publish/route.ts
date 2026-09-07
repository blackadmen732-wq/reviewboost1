import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireOrganizationContext } from "@/lib/server/auth";
import { publishCustomerPage } from "@/lib/server/customer-page-service";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { parseOrThrow } from "@/lib/server/validation";

/**
 * Atomically publish the current draft.
 *
 * The RPC checks the draft's shape, verifies every referenced asset is
 * owned by the caller's org and `ready`, then writes the immutable
 * `published` snapshot and increments `published_version` in the same
 * statement's transaction. A customer landing between the two writes
 * cannot see a half-published page.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/customer-page/publish";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z
  .strictObject({ locationId: z.string().regex(UUID_RE).optional() })
  .optional()
  .default({});

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    if (context.role !== "owner" && context.role !== "admin") {
      throw new ApiError(
        403,
        ERROR_CODE.forbidden,
        "Only the owner or an admin can publish the customer page.",
      );
    }
    const body = parseOrThrow(bodySchema, await readJsonBody(request));
    const profile = await publishCustomerPage(
      context,
      context.orgId,
      body.locationId ?? null,
      requestId,
    );
    return json(request, requestId, 200, profile);
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
