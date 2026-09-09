import "server-only";

import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";

/**
 * Sweep lapsed SMS credit allocations across every org.
 *
 * Calls `rpc_sms_quota_expire` (service-role only). Idempotent. Does not send
 * SMS or write through any owner session.
 */

export interface ExpireQuotaSummary {
  expired: number;
}

export async function expireQuotaOnce(): Promise<ExpireQuotaSummary> {
  const svc = serviceRoleClient();
  const { data, error } = await svc.rpc("rpc_sms_quota_expire");
  if (error) {
    logger.error("sms.quota_expire_failed", { error });
    throw error;
  }

  const expired = typeof data === "number" ? data : Number(data ?? 0);
  return { expired: Number.isFinite(expired) ? expired : 0 };
}
