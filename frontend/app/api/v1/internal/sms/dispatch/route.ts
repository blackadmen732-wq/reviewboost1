import { timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json } from "@/lib/server/http";
import { dispatchOnce } from "@/lib/server/sms/dispatch";
import { reconcileOnce } from "@/lib/server/sms/reconcile";

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

function authorized(request: Request): boolean {
  const secret = process.env.SMS_WORKER_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const parts = header.split(" ");
  // Exactly "Bearer <token>" — reject trailing junk like "Bearer <token> x".
  if (parts.length !== 2) return false;
  const [scheme, token] = parts;
  if (scheme?.toLowerCase() !== "bearer" || !token) return false;

  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    if (!authorized(request)) {
      // Indistinguishable from a route that does not exist.
      throw new ApiError(404, ERROR_CODE.notFound, "Not found.");
    }

    let dispatchError: unknown = null;
    let dispatch;
    try {
      dispatch = await dispatchOnce({ limit: 1, leaseSeconds: 90 });
    } catch (error) {
      dispatchError = error;
    }
    // Reconciliation must still run if dispatch claim/config throws — parked
    // provider_unknown rows are independent of this batch's send loop.
    const reconcile = await reconcileOnce({ limit: 1, leaseSeconds: 90 });
    if (dispatchError) throw dispatchError;
    return json(request, requestId, 200, { data: { ...dispatch, reconcile }, requestId });
  });
}
