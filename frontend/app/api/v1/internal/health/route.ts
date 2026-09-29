import type { NextRequest } from "next/server";

import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
import { readHealth } from "@/lib/server/ops-health";
import { workerAuthorized } from "@/lib/server/worker-auth";

/**
 * What an operator needs to know, in one read.
 *
 * Counts and ages only. Nothing here carries a phone number, a message body,
 * a token, or an organization id — a health endpoint that leaks the thing it
 * is monitoring is a worse problem than the outage it reports.
 *
 * The numbers that matter are the ones that grow silently: a dispatcher that
 * stopped draining, dead letters, sends whose outcome the provider never
 * confirmed, Twilio webhooks that failed or stopped verifying, unprocessed
 * Stripe events, and packs paid for without credit. Each is money or a missed
 * message, and none of them raises an error on its own.
 *
 * Unhealthy is a 503, so any uptime monitor pointed at this URL with the
 * worker secret is an alert without further wiring. The body is the same
 * either way.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/internal/health";

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    if (!workerAuthorized(request)) {
      throw new ApiError(404, ERROR_CODE.notFound, "Not found.");
    }

    let report;
    try {
      report = await readHealth();
    } catch (error) {
      logger.error("ops.health_read_failed", { requestId, error });
      throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Health is unavailable.");
    }

    return json(request, requestId, report.ok ? 200 : 503, {
      data: { ok: report.ok, problems: report.problems, ...report.signals },
      requestId,
    });
  });
}
