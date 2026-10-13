import type { NextRequest } from "next/server";

import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json } from "@/lib/server/http";
import { processIntegrations } from "@/lib/server/integrations/sync-runner";
import { workerAuthorized } from "@/lib/server/worker-auth";

/**
 * Internal Connections worker trigger: queue due reconciles, drain the
 * webhook inbox, advance sync runs, purge expired data.
 *
 * Same guard as the SMS dispatcher. Not scheduled yet (see
 * docs/backend/SCHEDULING.md): owner actions and webhooks run the worker
 * right after they respond, and a scheduler can call this once one is chosen.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ROUTE = "/api/v1/internal/integrations/process";

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    if (!workerAuthorized(request)) {
      throw new ApiError(404, ERROR_CODE.notFound, "Not found.");
    }
    const summary = await processIntegrations({ budgetMs: 45_000 });
    return json(request, requestId, 200, { data: summary, requestId });
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  return POST(request);
}
