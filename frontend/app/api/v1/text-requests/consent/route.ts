import type { NextRequest } from "next/server";

import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import { ApiError, ERROR_CODE, rateLimited } from "@/lib/server/errors";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { serviceRoleClient } from "@/lib/server/supabase";
import { parseOrThrow } from "@/lib/server/validation";
import {
  consentAttestationSchema,
  recordConsentAttestation,
} from "@/lib/server/sms/text-request-service";

/**
 * Record that a customer agreed to a Text Request.
 *
 * Owner/admin only. This is the only way the owner app records consent, and it
 * takes an explicit confirmation: how the customer agreed, the wording version
 * the owner confirmed, and `confirmed: true`. The acting user is taken from the
 * session, never from the body. Rate-limited per organization, failing closed.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/text-requests/consent";
const CONSENT_LIMIT_PER_MINUTE = 30;

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner", "admin"]);

    const { data: rl, error: rlError } = await serviceRoleClient().rpc("rpc_consume_rate_limit", {
      p_bucket: "sms_consent",
      p_bucket_key: context.orgId,
      p_limit: CONSENT_LIMIT_PER_MINUTE,
      p_window_seconds: 60,
    });
    if (rlError) {
      throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
    }
    const decision = Array.isArray(rl) ? rl[0] : rl;
    if (decision && decision.allowed === false) {
      throw rateLimited((decision.retry_after_seconds as number) ?? 60);
    }

    const body = parseOrThrow(consentAttestationSchema, await readJsonBody(request));
    const result = await recordConsentAttestation(context, body, requestId);

    return json(request, requestId, 201, { data: result, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
