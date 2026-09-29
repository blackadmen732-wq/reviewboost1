import type { NextRequest } from "next/server";

import { reconcileSmsPacks } from "@/lib/server/billing-service";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
import { raiseAlerts, readHealth, reconciliationExpected } from "@/lib/server/ops-health";
import { serviceRoleClient } from "@/lib/server/supabase";
import { workerAuthorized } from "@/lib/server/worker-auth";

/**
 * The periodic work nobody triggers.
 *
 * Reconciliation closes out sends whose outcome the provider never told us,
 * dead-letter release gives back credit for messages that never left, and
 * expiry retires monthly allowance at its billing boundary. Pack
 * reconciliation compares Stripe's paid pack sessions with the credit they
 * minted, and heals a webhook that never landed. None of it is driven by a
 * user action, so without a scheduler it simply never happens.
 *
 * Every step is idempotent, so running twice costs nothing and a missed run
 * is caught by the next one. One failing step does not stop the others: an
 * operator needs the rest to have run, and the failure recorded. The run ends
 * by reading health and raising an alert for anything wrong.
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

  // Stripe is not configured in every environment. Where it is not, there is
  // nothing to reconcile against — and health does not expect a run.
  if (reconciliationExpected()) {
    try {
      const packs = await reconcileSmsPacks();
      summary["reconcile_sms_packs"] = packs.ok ? packs.checked : `findings:${packs.findings}`;
      summary["reconcile_sms_packs_healed"] = packs.healed;
    } catch (error) {
      logger.error("maintenance.step_failed", { requestId, step: "reconcile_sms_packs", error });
      summary["reconcile_sms_packs"] = "failed";
    }
  } else {
    summary["reconcile_sms_packs"] = "skipped";
  }

  try {
    const report = await readHealth();
    summary["health"] = report.ok ? "ok" : report.problems.join(",");
    await raiseAlerts(report, "maintenance");
  } catch (error) {
    logger.error("ops.alert", { source: "maintenance", problems: ["health_unreadable"], error });
    summary["health"] = "failed";
  }

  return summary;
}

async function handleRequest(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    if (!workerAuthorized(request)) {
      // Indistinguishable from a route that does not exist.
      throw new ApiError(404, ERROR_CODE.notFound, "Not found.");
    }

    const summary = await runMaintenance(requestId);
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
