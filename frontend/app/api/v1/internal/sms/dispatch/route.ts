import { dispatchOnce } from "@/lib/server/sms/dispatch";
import { smsWorkerRoute } from "@/lib/server/sms/worker-route";

/**
 * Internal dispatch trigger.
 *
 * A scheduler (cron, queue drainer) hits this to run one dispatch batch. It is
 * not an owner or customer endpoint: it authenticates with a shared worker
 * secret, and when no secret is configured the route reports "not found" so its
 * existence leaks nothing. The real safety — leases, single-in-flight attempts,
 * idempotency — lives in the database, so an extra invocation cannot double a
 * send; this guard only stops a stranger from spinning the worker.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/internal/sms/dispatch";
const run = smsWorkerRoute(ROUTE, () => dispatchOnce({ limit: 25, leaseSeconds: 90 }));

export const GET = run;
export const POST = run;
