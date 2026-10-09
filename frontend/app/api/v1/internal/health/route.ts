import type { NextRequest } from "next/server";

import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json } from "@/lib/server/http";
import { checkConfiguration } from "@/lib/server/readiness";
import { serviceRoleClient } from "@/lib/server/supabase";
import { workerAuthorized } from "@/lib/server/worker-auth";

/**
 * What an operator needs to know, in one read.
 *
 * Counts and ages only. Nothing here carries a phone number, a message body,
 * a token, or an organization id — a health endpoint that leaks the thing it
 * is monitoring is a worse problem than the outage it reports.
 *
 * The numbers that matter are the ones that grow silently: an outbox that is
 * not draining, sends whose outcome the provider never confirmed, and webhook
 * inboxes with unprocessed rows. Each of those is money or a missed message,
 * and none of them raises an error on its own.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/internal/health";

// Cadence plus one missed run of slack: dispatch every minute, maintenance
// every fifteen. See docs/backend/OPERATIONS.md for the alert table.
const STALE_AFTER_SECONDS: Record<string, number> = {
  sms_dispatch: 5 * 60,
  maintenance: 45 * 60,
};

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    if (!workerAuthorized(request)) {
      throw new ApiError(404, ERROR_CODE.notFound, "Not found.");
    }

    const service = serviceRoleClient();
    const [{ data, error }, workers] = await Promise.all([
      service.rpc("rpc_sms_health"),
      service.rpc("rpc_worker_health"),
    ]);
    if (error) {
      throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Health is unavailable.");
    }

    const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;

    const outboxPending = Number(row?.["outbox_pending"] ?? 0);
    const oldestPendingAge = Number(row?.["oldest_pending_age_s"] ?? 0);
    const providerUnknown = Number(row?.["provider_unknown"] ?? 0);
    const oldestUnknownAge = Number(row?.["oldest_unknown_age_s"] ?? 0);
    const deadLetter = Number(row?.["outbox_dead_letter"] ?? 0);
    const smsWebhooks = Number(row?.["webhooks_unprocessed"] ?? 0);
    const stripeWebhooks = Number(row?.["stripe_unprocessed"] ?? 0);

    // Thresholds, not opinions: a minute-by-minute dispatcher that has left
    // something pending for ten minutes is not dispatching, and an unprocessed
    // Stripe event is billing state that has not been applied.
    const problems: string[] = [];
    if (oldestPendingAge > 600) problems.push("outbox_backlog");
    if (oldestUnknownAge > 3600) problems.push("provider_unknown_age");
    if (deadLetter > 0) problems.push("dead_letters");
    if (stripeWebhooks > 0) problems.push("stripe_webhooks_unprocessed");
    if (smsWebhooks > 0) problems.push("sms_webhooks_unprocessed");

    // The scheduler. A worker that has not succeeded within its cadence
    // (plus slack for one missed run) means nothing is being sent or settled,
    // even while every queue above still looks empty.
    const workerRows = workers.error
      ? []
      : ((workers.data ?? []) as Array<{
          worker: string;
          last_success_age_s: number | null;
          failing: boolean;
        }>);
    if (workers.error) problems.push("worker_health_unavailable");
    const scheduler: Record<string, { lastSuccessAgeSeconds: number | null; failing: boolean }> = {};
    for (const row of workerRows) {
      const age = row.last_success_age_s === null ? null : Number(row.last_success_age_s);
      scheduler[row.worker] = { lastSuccessAgeSeconds: age, failing: Boolean(row.failing) };
      const limit = STALE_AFTER_SECONDS[row.worker];
      if (limit !== undefined && (age === null || age > limit)) problems.push(`${row.worker}_stale`);
      if (row.failing) problems.push(`${row.worker}_failing`);
    }

    // Configuration drift after deploy (a variable removed in the dashboard)
    // is as fatal as a dead queue, so the gate's cheap half runs here too.
    const config = checkConfiguration();
    if (!config.ok) problems.push("config_not_ready");

    const ok = problems.length === 0;
    // 503 when unhealthy, so a monitor that only reads the status code is
    // not told "fine" about a product that is not sending.
    return json(request, requestId, ok ? 200 : 503, {
      data: {
        ok,
        problems,
        scheduler,
        config: { tier: config.tier, problems: config.problems.map((p) => p.subsystem) },
        outbox: { pending: outboxPending, deadLetter, oldestPendingAgeSeconds: oldestPendingAge },
        providerUnknown: { count: providerUnknown, oldestAgeSeconds: oldestUnknownAge },
        webhooks: { sms: smsWebhooks, stripe: stripeWebhooks },
      },
      requestId,
    });
  });
}
