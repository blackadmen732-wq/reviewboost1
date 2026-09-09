import type { NextRequest } from "next/server";

import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json, preflight } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";

/**
 * Pipe A Stripe sink — stub.
 * Does not mint SMS. Does not hardcode plan names into the owner UI.
 * Live signature verify lands with the Stripe plans job (MONEY.md §7 step 2).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/webhooks/stripe";

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const stub = process.env.STRIPE_WEBHOOK_STUB === "1";
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!stub && !secret) {
      logger.info("stripe.webhook_not_configured", { requestId });
      throw new ApiError(
        503,
        ERROR_CODE.serviceUnavailable,
        "Billing is not ready yet.",
      );
    }

    await request.text();
    return json(request, requestId, 202, {
      data: { accepted: true, wired: stub ? "stub" : "flag" },
      requestId,
    });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
