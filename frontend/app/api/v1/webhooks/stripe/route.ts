import type { NextRequest } from "next/server";

import { receiveStripeWebhook } from "@/lib/server/billing-service";
import { stripeWebhookSecret } from "@/lib/server/env";
import { handle, json } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
import { stripeClient } from "@/lib/server/stripe";

/**
 * Stripe's webhook sink.
 *
 * The signature is verified before a single byte is written anywhere. An
 * unverified webhook is anyone on the internet setting a business's billing
 * state, so there is no development bypass here — that branch is the one that
 * eventually ships.
 *
 * 200 is returned for a verified event even when handling it decided to do
 * nothing, because Stripe reads a non-2xx as "retry" and retrying an event
 * that was correctly ignored is noise. A handler that actually failed returns
 * 500 on purpose: that is the retry we want.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/webhooks/stripe";

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const signature = request.headers.get("stripe-signature");
    const raw = await request.text();

    if (!signature) {
      logger.warn("billing.webhook_unsigned", { requestId });
      return json(request, requestId, 400, {
        error: { code: "invalid_signature", message: "Missing signature." },
        requestId,
      });
    }

    let event;
    try {
      event = stripeClient().webhooks.constructEvent(raw, signature, stripeWebhookSecret());
    } catch (error) {
      // Logged without the body: an unverified payload is attacker-controlled
      // and has no business in a log an operator reads.
      logger.warn("billing.webhook_bad_signature", {
        requestId,
        error: error instanceof Error ? error.message : "unknown",
      });
      return json(request, requestId, 400, {
        error: { code: "invalid_signature", message: "Signature verification failed." },
        requestId,
      });
    }

    const { outcome } = await receiveStripeWebhook(event);
    logger.info("billing.webhook_handled", {
      requestId,
      eventId: event.id,
      type: event.type,
      outcome,
    });

    return json(request, requestId, 200, { data: { received: true, outcome }, requestId });
  });
}
