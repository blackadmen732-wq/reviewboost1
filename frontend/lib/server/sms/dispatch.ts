import "server-only";

import { randomUUID } from "node:crypto";

import { decrypt } from "@/lib/server/crypto";
import { logger } from "@/lib/server/logger";
import { failOutboxWithRetry } from "@/lib/server/sms/outbox";
import { getSmsProvider } from "@/lib/server/sms/provider";
import { serviceRoleClient } from "@/lib/server/supabase";

/**
 * The dispatch worker.
 *
 * A thin loop over the durable outbox: claim due jobs (the database's
 * FOR UPDATE SKIP LOCKED lease makes this safe to run in many copies), and for
 * each one run the final pre-send gate, hand the message to the provider, and
 * record the outcome. All the hard state — leases, retries, dead-lettering,
 * the single-in-flight-attempt guard — lives in SQL; this code only moves a job
 * through it and never holds authoritative state in memory.
 *
 * Nothing here retries a `provider_unknown`: an unknown outcome means the
 * message may already have gone out, so the request is parked for reconciliation
 * rather than risking a duplicate send.
 */

const BACKOFF_BASE_SECONDS = 30;

export interface DispatchSummary {
  claimed: number;
  submitted: number;
  suppressed: number;
  failed: number;
  retryable: number;
  unknown: number;
  deferred: number;
  skipped: number;
  failRecordFailed: number;
}

export async function dispatchOnce(options?: {
  limit?: number;
  leaseSeconds?: number;
  worker?: string;
}): Promise<DispatchSummary> {
  const svc = serviceRoleClient();
  const provider = getSmsProvider();
  const worker = options?.worker ?? `dispatch-${randomUUID().slice(0, 8)}`;
  const summary: DispatchSummary = {
    claimed: 0, submitted: 0, suppressed: 0, failed: 0, retryable: 0, unknown: 0, deferred: 0, skipped: 0,
    failRecordFailed: 0,
  };

  const { data: jobs, error } = await svc.rpc("rpc_sms_claim_outbox", {
    p_worker: worker,
    p_limit: options?.limit ?? 10,
    p_lease_seconds: options?.leaseSeconds ?? 60,
    p_topic: "sms.dispatch",
  });
  if (error) {
    logger.error("sms.dispatch_claim_failed", { error });
    throw error;
  }

  const claimed = (jobs ?? []) as Array<{ id: string; org_id: string; request_id: string | null; attempts: number }>;
  summary.claimed = claimed.length;

  for (const job of claimed) {
    const complete = () => svc.rpc("rpc_sms_complete_outbox", { p_id: job.id, p_worker: worker });

    try {
      if (!job.request_id) {
        await complete();
        summary.skipped += 1;
        continue;
      }

      const { data: begun, error: beginError } = await svc.rpc("rpc_sms_begin_dispatch", {
        p_request_id: job.request_id,
        p_org_id: job.org_id,
        p_provider: provider.name,
      });
      if (beginError) throw beginError;

      const b = (Array.isArray(begun) ? begun[0] : begun) as {
        outcome: string;
        attempt_id: string | null;
        message_encrypted: string | null;
        phone_encrypted: string | null;
        defer_until: string | null;
      };

      if (b.outcome === "deferred") {
        // Outside the recipient's send window (a delayed run): push the job to
        // the next permitted instant instead of sending during quiet hours.
        await svc.rpc("rpc_sms_defer_outbox", {
          p_id: job.id,
          p_worker: worker,
          p_until: b.defer_until,
        });
        summary.deferred += 1;
        continue;
      }
      if (b.outcome === "suppressed") {
        await complete();
        summary.suppressed += 1;
        continue;
      }
      if (b.outcome === "recovered_unknown") {
        // A prior worker died mid-send; the request is now parked as
        // provider_unknown for reconciliation. This job's work is done.
        await complete();
        summary.unknown += 1;
        continue;
      }
      if (b.outcome !== "sending" || !b.attempt_id) {
        // not_found, or already_* — a redelivered job for a settled request.
        await complete();
        summary.skipped += 1;
        continue;
      }

      const attemptId = b.attempt_id;

      const to = decrypt(b.phone_encrypted);
      const body = decrypt(b.message_encrypted);
      if (!to || !body) {
        // Should never happen; treat as a hard failure, not a silent drop.
        const { error: settleError } = await svc.rpc("rpc_sms_settle_attempt", {
          p_attempt_id: attemptId,
          p_org_id: job.org_id,
          p_outcome: "failed",
          p_provider_message_id: null,
          p_error_class: "provider_error",
          p_provider_response: { error: "decrypt_failed" },
        });
        if (settleError) throw settleError;
        await complete();
        summary.failed += 1;
        continue;
      }

      const result = await provider.send({ to, body, idempotencyKey: `req:${job.request_id}` });

      if (result.outcome === "retryable") {
        // Provider returned 429: definitively not accepted, safe to retry.
        // Settle the attempt as retryable — the SQL moves the request back
        // to 'queued' (keeping quota reserved) so the next dispatch creates
        // a fresh attempt after outbox backoff.
        const { error: settleError } = await svc.rpc("rpc_sms_settle_attempt", {
          p_attempt_id: attemptId,
          p_org_id: job.org_id,
          p_outcome: "retryable",
          p_provider_message_id: null,
          p_error_class: result.errorClass ?? "rate_limited",
          p_provider_response: result.raw ?? {},
        });
        if (settleError) throw settleError;
        const failRecord = await failOutboxWithRetry({
          jobId: job.id,
          worker,
          error: `retryable: ${result.errorClass ?? "rate_limited"}`,
          backoffSeconds: BACKOFF_BASE_SECONDS * Math.pow(2, Math.min(job.attempts, 6)),
        });
        if (!failRecord.recorded) {
          summary.failRecordFailed += 1;
          throw new Error("fail_outbox_unrecorded");
        }
        // Terminal dead-letter fails the queued request and releases the
        // reservation in the same SQL transaction as the outbox write.
        if (failRecord.status === "dead_letter") {
          summary.failed += 1;
        } else {
          summary.retryable += 1;
        }
        continue;
      }

      // The provider call already happened; if we cannot durably record its
      // outcome, do NOT complete the job — leave it recoverable so the state is
      // reconciled, never silently lost with the request stuck in 'sending'.
      const { error: settleError } = await svc.rpc("rpc_sms_settle_attempt", {
        p_attempt_id: attemptId,
        p_org_id: job.org_id,
        p_outcome: result.outcome,
        p_provider_message_id: result.providerMessageId ?? null,
        p_error_class: result.errorClass ?? null,
        p_provider_response: result.raw ?? {},
      });
      if (settleError) throw settleError;

      if (result.outcome === "submitted") summary.submitted += 1;
      else if (result.outcome === "failed") summary.failed += 1;
      else summary.unknown += 1;

      await complete();
    } catch (jobError) {
      // Transient infrastructure failure: back the job off. The outbox decides
      // whether this becomes a retry or a dead-letter based on attempts.
      // If fail_outbox itself cannot be recorded, the job stays leased until
      // expiry — begin_dispatch then parks a still-sending request as
      // provider_unknown rather than re-sending.
      logger.error("sms.dispatch_job_failed", { jobId: job.id, error: jobError });
      const failRecord = await failOutboxWithRetry({
        jobId: job.id,
        worker,
        error: jobError instanceof Error ? jobError.message : "unknown",
        backoffSeconds: BACKOFF_BASE_SECONDS * Math.pow(2, Math.min(job.attempts, 6)),
      });
      if (!failRecord.recorded) summary.failRecordFailed += 1;
      else if (failRecord.status === "dead_letter") summary.failed += 1;
    }
  }

  return summary;
}
