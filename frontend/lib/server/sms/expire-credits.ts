import "server-only";

import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";

/**
 * Credit-expiry sweep.
 *
 * Calls the existing `rpc_sms_quota_expire` cron target: append an idempotent
 * expiration ledger row for every lapsed allocation and drop it from the
 * projection. Safe to run repeatedly. Does not talk to any SMS provider.
 */

export interface ExpireCreditsSummary {
  expired: number;
}

export async function expireCreditsOnce(): Promise<ExpireCreditsSummary> {
  const svc = serviceRoleClient();
  const { data, error } = await svc.rpc("rpc_sms_quota_expire");
  if (error) {
    logger.error("sms.expire_credits_failed", { error });
    throw error;
  }
  return { expired: typeof data === "number" ? data : 0 };
}
