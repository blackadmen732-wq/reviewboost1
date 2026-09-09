import { expireCreditsOnce } from "@/lib/server/sms/expire-credits";
import { smsWorkerRoute } from "@/lib/server/sms/worker-route";

/**
 * Internal credit-expiry trigger.
 *
 * Sweeps lapsed quota allocations. No provider call.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/internal/sms/expire-credits";
const run = smsWorkerRoute(ROUTE, () => expireCreditsOnce());

export const GET = run;
export const POST = run;
