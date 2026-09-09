import type { NextRequest } from "next/server";

import { handle, json } from "@/lib/server/http";
import { expireQuotaOnce } from "@/lib/server/sms/expire-quota";
import { assertSmsWorkerAuthorized } from "@/lib/server/sms/worker-auth";

/**
 * Internal credit-expiry sweep.
 *
 * Calls `rpc_sms_quota_expire` so lapsed allocations become durable
 * `expiration` ledger rows. Idempotent. Does not send SMS. GET is for Vercel
 * Cron; POST is for an external scheduler.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/internal/sms/expire-quota";

async function run(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    assertSmsWorkerAuthorized(request);
    const summary = await expireQuotaOnce();
    return json(request, requestId, 200, { data: summary, requestId });
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  return run(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  return run(request);
}
