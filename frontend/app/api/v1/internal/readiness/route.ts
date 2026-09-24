import type { NextRequest } from "next/server";

import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json } from "@/lib/server/http";
import { checkConfiguration, checkLive, type LiveProbe } from "@/lib/server/readiness";
import { serviceRoleClient } from "@/lib/server/supabase";
import { workerAuthorized } from "@/lib/server/worker-auth";

/**
 * The promotion gate.
 *
 * The release procedure calls this on a candidate deployment *before* it is
 * given the production domain, and promotes only on 200. 503 means "this
 * build, with this configuration, against this database, cannot serve paying
 * customers" — the body says exactly why, naming variables and resources but
 * never their values.
 *
 * Behind the worker secret like every internal route, and reported as a 404
 * without it so its existence leaks nothing.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/internal/readiness";

const probe: LiveProbe = {
  async priceCatalog() {
    const { data, error } = await serviceRoleClient().rpc("rpc_billing_price_catalog");
    if (error) throw new Error("catalog");
    return (data ?? []) as Array<{ stripe_price_id: string; plan_id: string }>;
  },
  async bucket(name) {
    const { data, error } = await serviceRoleClient().storage.getBucket(name);
    if (error || !data) return { exists: false, public: false };
    return { exists: true, public: Boolean(data.public) };
  },
  async appliedMigrations() {
    const { data, error } = await serviceRoleClient().rpc("rpc_applied_migrations");
    if (error) throw new Error("ledger");
    return ((data ?? []) as unknown[]).map(String);
  },
  async smsHealth() {
    const { error } = await serviceRoleClient().rpc("rpc_sms_health");
    return !error;
  },
};

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    if (!workerAuthorized(request)) {
      throw new ApiError(404, ERROR_CODE.notFound, "Not found.");
    }

    const report = await checkLive(probe, checkConfiguration());
    return json(request, requestId, report.ok ? 200 : 503, { data: report, requestId });
  });
}
