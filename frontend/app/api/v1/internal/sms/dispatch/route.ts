import type { NextRequest } from "next/server";

import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json } from "@/lib/server/http";
import { withHeartbeat } from "@/lib/server/heartbeat";
import { type DispatchSummary, dispatchOnce } from "@/lib/server/sms/dispatch";
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

// One invocation keeps claiming batches while there is work and time. A
// single 25-message batch per minute caps throughput at 1,500 an hour, so a
// backlog left by a scheduler outage would take hours to clear. The budget
// stays well inside the platform's function timeout and the 90-second lease,
// so a batch is always finished (or its lease still held) before another
// invocation could claim the same job.
const BATCH = 25;
const LEASE_SECONDS = 90;
const TIME_BUDGET_MS = 40_000;
const MAX_BATCHES = 20;

export const maxDuration = 60;

async function drain(): Promise<DispatchSummary & { batches: number }> {
  const started = Date.now();
  const total: DispatchSummary & { batches: number } = {
    claimed: 0, submitted: 0, suppressed: 0, failed: 0, unknown: 0, deferred: 0, skipped: 0, batches: 0,
  };
  while (total.batches < MAX_BATCHES && Date.now() - started < TIME_BUDGET_MS) {
    const batch = await dispatchOnce({ limit: BATCH, leaseSeconds: LEASE_SECONDS });
    total.batches += 1;
    for (const key of Object.keys(batch) as Array<keyof DispatchSummary>) total[key] += batch[key];
    if (batch.claimed < BATCH) break;
  }
  return total;
}

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    if (!workerAuthorized(request)) {
      // Indistinguishable from a route that does not exist.
      throw new ApiError(404, ERROR_CODE.notFound, "Not found.");
    }

    const summary = await withHeartbeat("sms_dispatch", async () => ({
      result: await drain(),
      failure: null,
    }));
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
