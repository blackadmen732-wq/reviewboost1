import { after, type NextRequest } from "next/server";

import { encrypt } from "@/lib/server/crypto";
import { publicFrontendUrl } from "@/lib/server/env";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json } from "@/lib/server/http";
import { getAdapter } from "@/lib/server/integrations/adapters";
import { processIntegrations } from "@/lib/server/integrations/sync-runner";
import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";

/**
 * Connection webhooks (docs/connections/06 §6.6).
 *
 * Verify, store, answer. The raw body is checked against the provider's
 * signature over the exact registered address, parsed only enough to file it,
 * and written encrypted to the deduplicated inbox. Nothing is applied here:
 * the worker re-reads the current object from the provider, so a replayed or
 * out-of-order event cannot write stale data. A duplicate returns 200 so the
 * provider stops retrying; an event for an account no business has connected
 * is stored as skipped, never matched to anyone.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/webhooks/integrations/[provider]";
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const { provider } = await params;
    const adapter = getAdapter(provider);
    if (!adapter) throw new ApiError(404, ERROR_CODE.notFound, "Not found.");

    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
      throw new ApiError(400, ERROR_CODE.validationFailed, "Request body is too large.");
    }

    // The provider signs the address it was given, which is the public one,
    // not whatever host the request arrived on behind the platform's proxy.
    const url = new URL(`/api/v1/webhooks/integrations/${adapter.id}`, publicFrontendUrl()).toString();
    if (!adapter.verifyWebhook({ rawBody, headers: request.headers, url })) {
      throw new ApiError(403, ERROR_CODE.forbidden, "Signature verification failed.");
    }

    let event;
    try {
      event = adapter.parseWebhook(rawBody);
    } catch {
      throw new ApiError(400, ERROR_CODE.validationFailed, "The event could not be read.");
    }

    const { data, error } = await serviceRoleClient().rpc("rpc_integration_inbox_receive", {
      p_provider_id: adapter.id,
      p_provider_event_id: event.providerEventId,
      p_external_account_id: event.externalAccountId,
      p_event_type: event.type,
      p_object_type: event.objectType,
      p_object_id: event.objectId,
      p_object_version: event.objectVersion,
      p_occurred_at: event.occurredAt.toISOString(),
      p_payload_version: event.payloadVersion,
      p_body_encrypted: encrypt(rawBody),
    });
    if (error) {
      // A 5xx makes the provider retry, which is what we want when we could not store it.
      logger.error("integrations.webhook_store_failed", { requestId, providerId: adapter.id, error });
      throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please retry.");
    }
    const row = (Array.isArray(data) ? data[0] : data) as { inserted?: boolean; status?: string } | undefined;

    if (row?.inserted && row.status === "pending") {
      after(() => processIntegrations({ budgetMs: 20_000 }).then(() => undefined, () => undefined));
    }

    return json(request, requestId, 200, {
      data: { received: true, duplicate: row?.inserted === false },
      requestId,
    });
  });
}
