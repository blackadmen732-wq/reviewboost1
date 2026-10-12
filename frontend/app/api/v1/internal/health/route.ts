import type { NextRequest } from "next/server";

import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json } from "@/lib/server/http";
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

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    if (!workerAuthorized(request)) {
      throw new ApiError(404, ERROR_CODE.notFound, "Not found.");
    }

    const { data, error } = await serviceRoleClient().rpc("rpc_sms_health");
    if (error) {
      throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Health is unavailable.");
    }

    const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;

    // Connections: the same idea. A webhook inbox that is not draining, events
    // that gave up, and switched-on connections that have not read anything
    // in a day are each silent until an owner notices missing customers.
    const { data: integrationData, error: integrationError } = await serviceRoleClient().rpc("rpc_integration_health");
    if (integrationError) {
      throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Health is unavailable.");
    }
    const integration = Array.isArray(integrationData)
      ? (integrationData[0] as Record<string, unknown> | undefined)
      : undefined;
    const integrationInboxPending = Number(integration?.["inbox_pending"] ?? 0);
    const integrationInboxAge = Number(integration?.["oldest_pending_age_s"] ?? 0);
    const integrationDeadLetters = Number(integration?.["dead_letters"] ?? 0);
    const connectionsStalled = Number(integration?.["connections_stalled"] ?? 0);
    const runsFailed24h = Number(integration?.["runs_failed_24h"] ?? 0);
    const connectionsByState = (integration?.["connections_by_state"] ?? {}) as Record<string, number>;

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
    if (integrationInboxAge > 900) problems.push("integration_inbox_backlog");
    if (integrationDeadLetters > 0) problems.push("integration_dead_letters");
    if (connectionsStalled > 0) problems.push("connections_stalled");

    return json(request, requestId, 200, {
      data: {
        ok: problems.length === 0,
        problems,
        outbox: { pending: outboxPending, deadLetter, oldestPendingAgeSeconds: oldestPendingAge },
        providerUnknown: { count: providerUnknown, oldestAgeSeconds: oldestUnknownAge },
        webhooks: { sms: smsWebhooks, stripe: stripeWebhooks },
        connections: {
          byState: connectionsByState,
          stalled: connectionsStalled,
          runsFailed24h,
          inbox: {
            pending: integrationInboxPending,
            deadLetter: integrationDeadLetters,
            oldestPendingAgeSeconds: integrationInboxAge,
          },
        },
      },
      requestId,
    });
  });
}
