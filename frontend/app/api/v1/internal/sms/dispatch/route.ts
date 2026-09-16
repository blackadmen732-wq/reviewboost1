import type { NextRequest } from "next/server";

import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json } from "@/lib/server/http";
import { dispatchOnce } from "@/lib/server/sms/dispatch";
import { workerAuthorized } from "@/lib/server/worker-auth";

/**
 * Internal dispatch trigger.
 *
 * A scheduler (cron, queue drainer) POSTs here to run one dispatch batch. It is
 * not an owner or customer endpoint: it authenticates with a shared worker
 * secret, and when no secret is configured the route reports "not found" so its
 * existence leaks nothing. The real safety — leases, single-in-flight attempts,
 * idempotency — lives in the database, so an extra invocation cannot double a
 * send; this guard only stops a stranger from spinning the worker.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/internal/sms/dispatch";

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    if (!workerAuthorized(request)) {
      // Indistinguishable from a route that does not exist.
      throw new ApiError(404, ERROR_CODE.notFound, "Not found.");
    }

    const summary = await dispatchOnce({ limit: 25, leaseSeconds: 90 });
    return json(request, requestId, 200, { data: summary, requestId });
  });
}

/**
 * The platform's scheduler issues a GET, not a POST. Same guard, same work:
 * a cron that cannot reach the worker is a product where nothing ever sends.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return POST(request);
}
