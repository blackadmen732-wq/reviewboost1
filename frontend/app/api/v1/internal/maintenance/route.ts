import type { NextRequest } from "next/server";

import { reconcileSmsPacks } from "@/lib/server/billing-service";
import { stripeSecretKey } from "@/lib/server/env";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { withHeartbeat } from "@/lib/server/heartbeat";
import { handle, json } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";
import { workerAuthorized } from "@/lib/server/worker-auth";

/**
 * The periodic work nobody triggers.
 *
 * Reconciliation closes out sends whose outcome the provider never told us,
 * dead-letter release gives back credit for messages that never left, and
 * expiry retires monthly allowance at its billing boundary, and text packs
 * paid in Stripe are checked against the credit they gave. None of it is
 * driven by a user action, so without a scheduler all three simply never
 * happen — which shows up as credit stuck in reservations and businesses
 * unable to send.
 *
 * Every step is idempotent, so running twice costs nothing and a missed run
 * is caught by the next one. One failing step does not stop the others: an
 * operator needs the rest to have run, and the failure recorded.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/internal/maintenance";

const STEPS = [
  { name: "reconcile_aged_unknowns", rpc: "rpc_sms_reconcile_aged_unknowns", args: {} },
  { name: "release_dead_letters", rpc: "rpc_sms_release_dead_letters", args: {} },
  { name: "expire_quota", rpc: "rpc_sms_quota_expire", args: {} },
  // A trial that has ended already opens no doors — the resolver asks the
  // clock, not the stored status. This makes the stored status agree, so that
  // an owner's billing screen and an operator's query say the same thing.
  { name: "expire_trials", rpc: "rpc_entitlements_expire_trials", args: {} },
] as const;

async function runMaintenance(requestId: string): Promise<Record<string, number | string>> {
  const service = serviceRoleClient();
  const summary: Record<string, number | string> = {};

  for (const step of STEPS) {
    const { data, error } = await service.rpc(step.rpc, step.args);
    if (error) {
      logger.error("maintenance.step_failed", { requestId, step: step.name, error });
      summary[step.name] = "failed";
      continue;
    }
    summary[step.name] = typeof data === "number" ? data : 0;
  }

  summary["reconcile_sms_packs"] = await reconcilePacksStep(requestId);
  return summary;
}

/**
 * Text packs paid in Stripe against the credit the ledger gave.
 *
 * Maintenance runs every fifteen minutes in production (and once a day on the
 * Vercel cron floor); reconciliation does not need to. It runs when the last
 * run is a day old, or an hour after one that was not ok — so a failing run
 * is retried without turning every pass into another Stripe listing and
 * another alert. Where Stripe is not configured at all there is nothing to
 * compare, and nothing is pretended: the step reports "skipped".
 *
 * Its failures are its own. A Stripe outage records a failed reconciliation
 * run, which health reports as `packs_reconcile_not_ok`; it does not mark the
 * maintenance worker failed, because the steps above it — releasing credit,
 * expiring allowances — did run, and an operator told "maintenance is
 * failing" would look in the wrong place.
 */
const RECONCILE_EVERY_SECONDS = 23 * 60 * 60;
const RECONCILE_RETRY_AFTER_SECONDS = 60 * 60;

async function reconcilePacksStep(requestId: string): Promise<number | string> {
  try {
    stripeSecretKey();
  } catch {
    return "skipped";
  }

  const { data, error } = await serviceRoleClient().rpc("rpc_billing_pack_health");
  if (!error) {
    const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
    const age = row?.["last_reconcile_age_s"];
    const lastOk = row?.["last_reconcile_ok"];
    if (age !== null && age !== undefined) {
      const seconds = Number(age);
      const wait = lastOk === false ? RECONCILE_RETRY_AFTER_SECONDS : RECONCILE_EVERY_SECONDS;
      if (seconds < wait) return "not_due";
    }
  }
  // A health read that failed is no reason to skip: run, and let the run's
  // own record say how it went.

  try {
    const result = await reconcileSmsPacks();
    if (result.errors > 0) {
      logger.error("maintenance.pack_reconcile_errors", { requestId, errors: result.errors });
    }
    return result.healed;
  } catch (error) {
    logger.error("maintenance.pack_reconcile_failed", {
      requestId,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return "reconcile_failed";
  }
}

async function handleRequest(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    if (!workerAuthorized(request)) {
      // Indistinguishable from a route that does not exist.
      throw new ApiError(404, ERROR_CODE.notFound, "Not found.");
    }

    const summary = await withHeartbeat("maintenance", async () => {
      const result = await runMaintenance(requestId);
      const failed = Object.entries(result)
        .filter(([, value]) => value === "failed")
        .map(([step]) => step);
      return { result, failure: failed.length > 0 ? `failed: ${failed.join(",")}` : null };
    });
    logger.info("maintenance.completed", { requestId, ...summary });
    return json(request, requestId, 200, { data: summary, requestId });
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return handleRequest(request);
}

/** The platform's scheduler issues a GET. */
export async function GET(request: NextRequest): Promise<Response> {
  return handleRequest(request);
}
