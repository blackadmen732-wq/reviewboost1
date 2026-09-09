import "server-only";

import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";
import { getSmsProvider } from "@/lib/server/sms/provider";

/**
 * Reconciliation sweep for `provider_unknown` attempts.
 *
 * Never re-sends. An unknown outcome means the message may already have gone
 * out; retrying would risk a duplicate. This worker only asks the configured
 * provider whether a known message id has reached a terminal status, then
 * applies that status through the existing RPC.
 *
 * A fake provider answers from programmed lookups only. Twilio's poll is not
 * invoked here — this sprint does not touch a live gateway.
 */

export interface ReconcileSummary {
  scanned: number;
  applied: number;
  stillUnknown: number;
  skipped: number;
}

interface UnresolvedAttempt {
  id: string;
  org_id: string;
  request_id: string;
  provider: string;
  provider_message_id: string | null;
}

export async function reconcileOnce(options?: { limit?: number }): Promise<ReconcileSummary> {
  const svc = serviceRoleClient();
  const provider = getSmsProvider();
  const summary: ReconcileSummary = { scanned: 0, applied: 0, stillUnknown: 0, skipped: 0 };

  const { data, error } = await svc.rpc("rpc_sms_list_unresolved_attempts", {
    p_limit: options?.limit ?? 25,
  });
  if (error) {
    logger.error("sms.reconcile_list_failed", { error });
    throw error;
  }

  const attempts = (data ?? []) as UnresolvedAttempt[];
  summary.scanned = attempts.length;

  for (const attempt of attempts) {
    if (!attempt.provider_message_id) {
      // No provider id means we cannot poll. Leave it for a human.
      summary.skipped += 1;
      continue;
    }

    if (!provider.lookupStatus) {
      summary.stillUnknown += 1;
      continue;
    }

    const looked = await provider.lookupStatus(attempt.provider_message_id);
    if (!looked || !looked.terminal) {
      summary.stillUnknown += 1;
      continue;
    }

    const { error: applyError } = await svc.rpc("rpc_sms_apply_delivery_status", {
      p_provider: attempt.provider,
      p_provider_message_id: attempt.provider_message_id,
      p_terminal: looked.terminal,
      p_error_class: looked.errorClass ?? null,
    });
    if (applyError) {
      logger.error("sms.reconcile_apply_failed", { attemptId: attempt.id, error: applyError });
      throw applyError;
    }
    summary.applied += 1;
  }

  return summary;
}
