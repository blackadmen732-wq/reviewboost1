import "server-only";

import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";

const FAIL_OUTBOX_ATTEMPTS = 3;

/**
 * Record an outbox failure with a short retry. A lost fail write leaves the
 * job leased; the next claim (or lease expiry) recovers it. Swallowing a
 * single RPC error used to hide a terminal path until that lease expired.
 */
export async function failOutboxWithRetry(input: {
  jobId: string;
  worker: string;
  error: string;
  backoffSeconds: number;
}): Promise<{ status: string | null; recorded: boolean }> {
  const svc = serviceRoleClient();
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= FAIL_OUTBOX_ATTEMPTS; attempt += 1) {
    const { data, error } = await svc.rpc("rpc_sms_fail_outbox", {
      p_id: input.jobId,
      p_worker: input.worker,
      p_error: input.error,
      p_backoff_seconds: input.backoffSeconds,
    });
    // A missing row returns SQL NULL with no PostgREST error — that is not recorded.
    if (!error && typeof data === "string") {
      return { status: data, recorded: true };
    }
    lastError = error ?? { message: "fail_outbox_null_status" };
    logger.error("sms.outbox_fail_record_failed", {
      jobId: input.jobId,
      attempt,
      error: lastError,
    });
  }

  logger.error("sms.outbox_fail_record_exhausted", { jobId: input.jobId, error: lastError });
  return { status: null, recorded: false };
}
