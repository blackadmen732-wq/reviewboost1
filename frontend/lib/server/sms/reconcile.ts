import "server-only";

import { randomUUID } from "node:crypto";

import { decrypt } from "@/lib/server/crypto";
import { logger } from "@/lib/server/logger";
import { failOutboxWithRetry } from "@/lib/server/sms/outbox";
import { getSmsProvider } from "@/lib/server/sms/provider";
import { serviceRoleClient } from "@/lib/server/supabase";

/**
 * Durable provider_unknown reconciler.
 *
 * Claims `sms.reconcile` outbox jobs (never dispatch), looks up the SID at
 * the provider without sending, then either attaches the SID (and replays
 * parked receipts) or fails+releases. Lookup ambiguity keeps the reservation
 * and backs the job off until the outbox budget expires — then fail+release.
 */

const BACKOFF_BASE_SECONDS = 30;

export interface ReconcileSummary {
  claimed: number;
  attached: number;
  applied: number;
  released: number;
  deferred: number;
  skipped: number;
  failedRecord: number;
}

export async function reconcileOnce(options?: {
  limit?: number;
  leaseSeconds?: number;
  worker?: string;
}): Promise<ReconcileSummary> {
  const svc = serviceRoleClient();
  const provider = getSmsProvider();
  const worker = options?.worker ?? `reconcile-${randomUUID().slice(0, 8)}`;
  const summary: ReconcileSummary = {
    claimed: 0, attached: 0, applied: 0, released: 0, deferred: 0, skipped: 0, failedRecord: 0,
  };

  const { data: jobs, error } = await svc.rpc("rpc_sms_claim_outbox", {
    p_worker: worker,
    p_limit: options?.limit ?? 10,
    p_lease_seconds: options?.leaseSeconds ?? 60,
    p_topic: "sms.reconcile",
  });
  if (error) {
    logger.error("sms.reconcile_claim_failed", { error });
    throw error;
  }

  const claimed = (jobs ?? []) as Array<{ id: string; org_id: string; request_id: string | null; attempts: number }>;
  summary.claimed = claimed.length;

  for (const job of claimed) {
    const complete = async () => {
      const { error: completeError } = await svc.rpc("rpc_sms_complete_outbox", {
        p_id: job.id,
        p_worker: worker,
      });
      if (completeError) throw completeError;
    };
    const deferUnknown = async (reason: string) => {
      const recorded = await failOutboxWithRetry({
        jobId: job.id,
        worker,
        error: reason,
        backoffSeconds: BACKOFF_BASE_SECONDS * Math.pow(2, Math.min(job.attempts, 6)),
      });
      if (!recorded.recorded) summary.failedRecord += 1;
      if (recorded.status === "dead_letter") summary.released += 1;
      else summary.deferred += 1;
    };

    try {
      if (!job.request_id) {
        await complete();
        summary.skipped += 1;
        continue;
      }

      const { data: prepared, error: prepError } = await svc.rpc("rpc_sms_reconcile_prepare", {
        p_request_id: job.request_id,
        p_org_id: job.org_id,
      });
      if (prepError) throw prepError;

      const row = (Array.isArray(prepared) ? prepared[0] : prepared) as {
        outcome: string;
        attempt_id: string | null;
        provider: string | null;
        phone_encrypted: string | null;
        message_encrypted: string | null;
        dispatched_at: string | null;
      } | null;

      if (!row || row.outcome !== "ready" || !row.attempt_id) {
        await complete();
        summary.skipped += 1;
        continue;
      }

      const to = decrypt(row.phone_encrypted);
      const body = decrypt(row.message_encrypted);
      if (!to || !body) {
        // Cannot look up without the original identity. Fail-closed: do not
        // invent a match; keep reserved and let the outbox budget expire.
        await deferUnknown("decrypt_failed");
        continue;
      }

      const lookup = await provider.lookup({
        idempotencyKey: `req:${job.request_id}`,
        to,
        body,
        ...(row.dispatched_at ? { sentAfter: new Date(row.dispatched_at) } : {}),
      });

      if (lookup.outcome === "unknown") {
        await deferUnknown(`lookup_unknown: ${lookup.errorClass ?? "unknown"}`);
        continue;
      }

      if (lookup.outcome === "not_found") {
        const { data: released, error: failError } = await svc.rpc("rpc_sms_reconcile_fail_release", {
          p_request_id: job.request_id,
          p_org_id: job.org_id,
          p_error: "provider_not_found",
        });
        if (failError) throw failError;
        await complete();
        if (released === "failed") summary.released += 1;
        else summary.skipped += 1;
        continue;
      }

      const { data: attached, error: attachError } = await svc.rpc("rpc_sms_reconcile_attach_sid", {
        p_attempt_id: row.attempt_id,
        p_org_id: job.org_id,
        p_provider_message_id: lookup.providerMessageId,
        p_terminal: lookup.terminal ?? null,
        p_error_class: lookup.errorClass ?? null,
      });
      if (attachError) throw attachError;

      if (attached === "sid_conflict" || attached === "invalid" || attached === "not_found") {
        await deferUnknown(`attach_${String(attached)}`);
        continue;
      }

      await complete();
      if (attached === "delivered" || attached === "failed") summary.applied += 1;
      else summary.attached += 1;
    } catch (jobError) {
      logger.error("sms.reconcile_job_failed", { jobId: job.id, error: jobError });
      const recorded = await failOutboxWithRetry({
        jobId: job.id,
        worker,
        error: jobError instanceof Error ? jobError.message : "unknown",
        backoffSeconds: BACKOFF_BASE_SECONDS * Math.pow(2, Math.min(job.attempts, 6)),
      });
      if (!recorded.recorded) summary.failedRecord += 1;
      else if (recorded.status === "dead_letter") summary.released += 1;
      else summary.deferred += 1;
    }
  }

  return summary;
}
