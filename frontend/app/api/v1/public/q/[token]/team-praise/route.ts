import type { NextRequest } from "next/server";

import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, preflight } from "@/lib/server/http";

/**
 * Retired. Team Praise is not part of the V1 public contract.
 *
 * The V1 customer flow is: open the Tag, tap 1 to 5, the rating is saved
 * privately, Google is offered. Nothing else is collected from the customer.
 *
 * WHY THIS FILE STILL EXISTS
 * --------------------------
 * Deleting it would make the path fall through to the framework's 404, which is
 * the same answer a bad or rotated token produces. A client on an old build
 * would read that as "this Tag is broken" and retry forever. 410 says the thing
 * that is actually true: the endpoint is gone for everyone, stop calling it.
 *
 * It is not in the OpenAPI contract or the generated client — this is the
 * answer for clients built before it was removed, not a documented endpoint.
 *
 * WHAT IS DELIBERATELY NOT REMOVED
 * --------------------------------
 * `public.team_praise_records` and every row in it, the encrypted name and note
 * columns, and all owner-side reading, matching, and tally paths. A business
 * that collected praise still owns that history. Retiring a customer-facing
 * write path is not a reason to destroy what it wrote.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/public/q/[token]/team-praise";

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async () => {
    throw new ApiError(
      410,
      ERROR_CODE.endpointRetired,
      "Team Praise is no longer collected from customers.",
    );
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
