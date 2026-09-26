import type { NextRequest } from "next/server";

import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import { ApiError, ERROR_CODE, rateLimited } from "@/lib/server/errors";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { serviceRoleClient } from "@/lib/server/supabase";
import { parseOrThrow } from "@/lib/server/validation";
import {
  listTextRequests,
  scheduleSchema,
  scheduleTextRequest,
} from "@/lib/server/sms/text-request-service";

/**
 * Text Requests — schedule a review-request text, and list recent ones.
 *
 * Owner/admin only. Scheduling is rate-limited per organization (a shared,
 * database-backed limiter, so it holds across serverless instances), validated
 * with a strict Zod schema, and idempotent through the request's dedupe key.
 * Every raw error is turned into an opaque client message; nothing from the
 * database or the provider crosses the wire.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/text-requests";
const SCHEDULE_LIMIT_PER_MINUTE = 60;

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner", "admin"]);

    // Per-org rate limit, shared across instances via the database. A limiter
    // that cannot reach its store must fail closed, never open: if the RPC
    // errors we cannot prove the request is under budget, so refuse rather than
    // wave it through.
    const { data: rl, error: rlError } = await serviceRoleClient().rpc("rpc_consume_rate_limit", {
      p_bucket: "sms_schedule",
      p_bucket_key: context.orgId,
      p_limit: SCHEDULE_LIMIT_PER_MINUTE,
      p_window_seconds: 60,
    });
    if (rlError) {
      throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
    }
    const decision = Array.isArray(rl) ? rl[0] : rl;
    if (decision && decision.allowed === false) {
      throw rateLimited((decision.retry_after_seconds as number) ?? 60);
    }

    const body = parseOrThrow(scheduleSchema, await readJsonBody(request));
    const result = await scheduleTextRequest(context, body, requestId);

    return json(request, requestId, result.created ? 201 : 200, { data: result, requestId });
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner", "admin", "member", "viewer"]);

    const url = new URL(request.url);
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : 25;
    if (limitRaw && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
      throw new ApiError(400, ERROR_CODE.validationFailed, "limit must be between 1 and 100.");
    }

    // Balances come back with the list, from one place. The page has no
    // business knowing that Starter includes 150 — it shows what the ledger
    // says is left, by source, or it shows nothing.
    const [items, balance] = await Promise.all([
      listTextRequests(context, limit),
      // As the signed-in owner, so the function's own membership check applies.
      context.db.rpc("rpc_sms_balance", { p_org_id: context.orgId }),
    ]);

    if (balance.error) {
      throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
    }

    const row = Array.isArray(balance.data)
      ? (balance.data[0] as { monthly: number; purchased: number; total: number } | undefined)
      : undefined;

    return json(request, requestId, 200, {
      data: {
        items,
        balance: {
          monthly: Number(row?.monthly ?? 0),
          purchased: Number(row?.purchased ?? 0),
          total: Number(row?.total ?? 0),
        },
      },
      requestId,
    });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
