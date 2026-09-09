import { reconcileOnce } from "@/lib/server/sms/reconcile";
import { smsWorkerRoute } from "@/lib/server/sms/worker-route";

/**
 * Internal reconciliation trigger.
 *
 * Polls programmed (fake) or configured provider status for unresolved
 * attempts. Never re-sends. Same worker-secret gate as dispatch.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/internal/sms/reconcile";
const run = smsWorkerRoute(ROUTE, () => reconcileOnce({ limit: 25 }));

export const GET = run;
export const POST = run;
