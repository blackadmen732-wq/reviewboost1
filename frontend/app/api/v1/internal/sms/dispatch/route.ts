import type { NextRequest } from "next/server";

import { handle, json } from "@/lib/server/http";
import { dispatchOnce } from "@/lib/server/sms/dispatch";
import { assertSmsWorkerAuthorized } from "@/lib/server/sms/worker-auth";

/**
 * Internal dispatch trigger.
 *
 * A scheduler (Vercel Cron GET, or an external POST) hits this to run one
 * dispatch batch. It is not an owner or customer endpoint: it authenticates
 * with a shared worker secret, and when no secret is configured the route
 * reports "not found" so its existence leaks nothing. The real safety —
 * leases, single-in-flight attempts, idempotency — lives in the database, so
 * an extra invocation cannot double a send; this guard only stops a stranger
 * from spinning the worker.
 *
 * GET exists because Vercel Cron invokes the path with GET. POST remains for
 * external schedulers. Both call the same batch. The provider is whatever
 * `getSmsProvider()` selects — tests and local use the fake; production
 * requires an explicit configured provider.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/internal/sms/dispatch";

async function run(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    assertSmsWorkerAuthorized(request);
    const summary = await dispatchOnce({ limit: 25, leaseSeconds: 90 });
    return json(request, requestId, 200, { data: summary, requestId });
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  return run(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  return run(request);
}
