import "server-only";

import { requireOrganizationContext, requireRole, type OrganizationContext } from "@/lib/server/auth";
import { ApiError, ERROR_CODE, rateLimited } from "@/lib/server/errors";
import { serviceRoleClient } from "@/lib/server/supabase";

/** Connections are an owner/admin setting, like billing. */
export async function requireConnectionsAdmin(request: Request): Promise<OrganizationContext> {
  const context = await requireOrganizationContext(request);
  requireRole(context.role, ["owner", "admin"]);
  return context;
}

/** Per-organization rate limit that fails closed, as the other owner actions do. */
export async function consumeRateLimit(bucket: string, key: string, limit: number, windowSeconds: number): Promise<void> {
  const { data, error } = await serviceRoleClient().rpc("rpc_consume_rate_limit", {
    p_bucket: bucket,
    p_bucket_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
  const decision = Array.isArray(data) ? data[0] : data;
  if (decision && decision.allowed === false) {
    throw rateLimited((decision.retry_after_seconds as number) ?? windowSeconds);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function connectionIdOrThrow(value: string): string {
  if (!UUID_RE.test(value)) throw new ApiError(404, ERROR_CODE.notFound, "That connection was not found.");
  return value;
}
