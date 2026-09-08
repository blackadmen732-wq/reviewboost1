import type { NextRequest } from "next/server";

import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
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

    // Per-org rate limit, shared across instances via the database. Store
    // errors and empty decisions fail closed (503) — never an empty allow.
    await consumeRateLimit(
      { bucket: "sms_schedule", limit: SCHEDULE_LIMIT_PER_MINUTE, windowSeconds: 60 },
      context.orgId,
      requestId,
    );

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

    const items = await listTextRequests(context, limit);
    return json(request, requestId, 200, { data: { items }, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
