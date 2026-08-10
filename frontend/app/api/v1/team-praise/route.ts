import type { NextRequest } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { handle, json, preflight } from "@/lib/server/http";
import { listTeamPraise } from "@/lib/server/owner-service";

/**
 * Team Praise, rating-blind by construction.
 *
 * The owner decides whether to recognise a colleague on what the customer
 * wrote, not on the stars that happened to accompany it. That is not a policy
 * this handler enforces — `team_praise_records` has no rating column and the
 * query performs no join to `customer_responses`, so there is nothing to leak.
 *
 * A test asserts the serialised response contains no rating, star, Google,
 * bonus, payroll, phone, or email field.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/team-praise";

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireUser(request);
    const url = new URL(request.url);

    const limitParam = url.searchParams.get("limit");
    const parsedLimit = limitParam === null ? undefined : Number(limitParam);
    const cursor = url.searchParams.get("cursor") ?? undefined;

    const page = await listTeamPraise(
      context,
      {
        cursor,
        limit: Number.isFinite(parsedLimit) ? (parsedLimit as number) : 25,
      },
      requestId,
    );

    return json(request, requestId, 200, { ...page, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
