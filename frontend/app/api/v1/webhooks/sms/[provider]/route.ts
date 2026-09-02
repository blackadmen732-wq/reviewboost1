import type { NextRequest } from "next/server";

import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json } from "@/lib/server/http";
import { isKnownProvider, receiveWebhook } from "@/lib/server/sms/webhook-service";

/**
 * SMS provider webhook sink (delivery receipts and inbound messages).
 *
 * The body is read raw — providers post form-encoded, not JSON — and handed to
 * the provider adapter for signature verification and parsing. Every event is
 * written to the durable, deduplicated inbox before any processing, so a
 * provider retry is harmless. An unverified signature is captured but rejected
 * with 403; a duplicate returns 200 so the provider stops retrying.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/webhooks/sms/[provider]";
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const { provider } = await params;
    if (!isKnownProvider(provider.toLowerCase())) {
      throw new ApiError(404, ERROR_CODE.notFound, "Unknown provider.");
    }

    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      throw new ApiError(400, ERROR_CODE.validationFailed, "Request body is too large.");
    }

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    const outcome = await receiveWebhook({
      provider: provider.toLowerCase(),
      url: request.url,
      headers,
      rawBody,
    });

    if (outcome.action === "unverified") {
      // Captured for forensics, but not acted upon and not accepted.
      throw new ApiError(403, ERROR_CODE.forbidden, "Signature verification failed.");
    }

    return json(request, requestId, 200, {
      data: { received: true, duplicate: outcome.duplicate, action: outcome.action },
      requestId,
    });
  });
}
