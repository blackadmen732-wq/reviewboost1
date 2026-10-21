import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ConnectionUnavailableError,
  applyResolved,
  applyVisitBatch,
  loadConnection,
  reportOutcome,
  type Counts,
} from "@/lib/server/integrations/pipeline";
import { ProviderError, type ParsedEvent } from "@/lib/server/integrations/types";
import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";

/**
 * The integrations worker (docs/connections/06 §6.10).
 *
 * Like the SMS dispatcher, a thin loop over durable state: every lease, retry,
 * dead letter and idempotency key lives in SQL, so running this in several
 * copies at once, or killing it halfway, loses nothing and doubles nothing.
 * Each call works until its time budget and yields what it has not finished.
 */

const BACKFILL_DAYS = 30;
const RECONCILE_INTERVAL_SECONDS = 6 * 60 * 60;
const RECONCILE_OVERLAP_MS = 15 * 60_000;
const RUN_LEASE_SECONDS = 120;
const INBOX_LEASE_SECONDS = 60;

export interface ProcessSummary {
  reconcilesQueued: number;
  inboxProcessed: number;
  inboxRetried: number;
  inboxDeadLettered: number;
  runsFinished: number;
  runsYielded: number;
  runsRetried: number;
  purged: { profiles: number; visits: number; customers: number };
}

/** Exponential backoff with jitter, capped at six hours; a provider's Retry-After wins if longer. */
export function backoffSeconds(attempts: number, retryAfterMs?: number, random: () => number = Math.random): number {
  const base = Math.min(2 ** Math.max(0, attempts) * 30, 6 * 60 * 60);
  const jittered = Math.round(base * (0.8 + random() * 0.4));
  const floor = retryAfterMs ? Math.ceil(retryAfterMs / 1000) : 0;
  return Math.max(1, jittered, floor);
}

function firstRow<T>(data: unknown): T | undefined {
  return (Array.isArray(data) ? data[0] : data) as T | undefined;
}

// ------------------------------------------------------------ reconcile ---

async function queueDueReconciles(svc: SupabaseClient, now: Date): Promise<number> {
  const { data, error } = await svc.rpc("rpc_integration_due_connections", {
    p_limit: 20,
    p_interval_seconds: RECONCILE_INTERVAL_SECONDS,
  });
  if (error) throw error;

  let queued = 0;
  const bucket = Math.floor(now.getTime() / (RECONCILE_INTERVAL_SECONDS * 1000));
  for (const due of (data ?? []) as Array<{ connection_id: string; org_id: string; workflow_id: string }>) {
    const stream = due.workflow_id === "appointments" ? "bookings" : "payments";
    const start = await reconcileStart(svc, due.connection_id, stream, now);
    const { error: enqueueError } = await svc.rpc("rpc_integration_enqueue_run", {
      p_connection_id: due.connection_id,
      p_org_id: due.org_id,
      p_kind: "reconcile",
      p_stream: stream,
      p_idempotency_key: `reconcile:${bucket}:${stream}`,
      p_window_start: start.toISOString(),
      p_window_end: now.toISOString(),
    });
    if (enqueueError) {
      logger.warn("integrations.reconcile_enqueue_failed", { connectionId: due.connection_id, error: enqueueError });
      continue;
    }
    queued += 1;
  }
  return queued;
}

/** From the last fully-applied point, with an overlap for clock skew and in-flight writes. */
export async function reconcileStart(
  svc: SupabaseClient,
  connectionId: string,
  stream: string,
  now: Date,
): Promise<Date> {
  const { data } = await svc.rpc("rpc_integration_checkpoint_high_water", {
    p_connection_id: connectionId,
    p_stream: stream,
  });
  const highWater = (data as string | null | undefined) ?? null;
  if (highWater) return new Date(new Date(highWater).getTime() - RECONCILE_OVERLAP_MS);
  return new Date(now.getTime() - BACKFILL_DAYS * 86_400_000);
}

// ----------------------------------------------------------------- inbox ---

interface InboxRow {
  id: string;
  connection_id: string;
  org_id: string;
  provider_event_id: string;
  external_account_id: string;
  event_type: string;
  object_type: string | null;
  object_id: string | null;
  object_version: number | null;
  occurred_at: string;
  payload_version: string;
  attempts: number;
}

async function settleInbox(
  svc: SupabaseClient,
  row: InboxRow,
  worker: string,
  result: "processed" | "skipped" | "retry",
  outcome: string,
  backoff = 0,
): Promise<string> {
  const { data, error } = await svc.rpc("rpc_integration_inbox_settle", {
    p_id: row.id,
    p_worker: worker,
    p_result: result,
    p_outcome_code: outcome,
    p_backoff_seconds: backoff,
  });
  if (error) throw error;
  return String(data);
}

async function processInboxRow(svc: SupabaseClient, row: InboxRow, worker: string, summary: ProcessSummary): Promise<void> {
  let loaded;
  try {
    loaded = await loadConnection(svc, row.connection_id);
  } catch (caught) {
    if (caught instanceof ConnectionUnavailableError) {
      await settleInbox(svc, row, worker, "skipped", caught.code);
      summary.inboxProcessed += 1;
      return;
    }
    if (caught instanceof ProviderError) {
      // Refresh was refused: the connection is now reauth_required and the
      // event is held until the owner signs in again.
      await settleInbox(svc, row, worker, "retry", caught.classification.reason, 3600);
      summary.inboxRetried += 1;
      return;
    }
    throw caught;
  }

  const event: ParsedEvent = {
    providerEventId: row.provider_event_id,
    externalAccountId: row.external_account_id,
    type: row.event_type,
    objectType: (row.object_type ?? "other") as ParsedEvent["objectType"],
    objectId: row.object_id,
    objectVersion: row.object_version,
    occurredAt: new Date(row.occurred_at),
    payloadVersion: row.payload_version,
  };

  let resolved;
  try {
    resolved = await loaded.adapter.resolveEvent(loaded.ctx, event);
  } catch (caught) {
    const classification = loaded.adapter.classifyError(caught);
    await reportOutcome(svc, loaded.connection, classification);
    if (classification.kind === "permanent") {
      await settleInbox(svc, row, worker, "processed", "rejected");
      summary.inboxProcessed += 1;
      return;
    }
    const backoff =
      classification.kind === "auth"
        ? 3600
        : backoffSeconds(row.attempts, classification.kind === "retryable" ? classification.retryAfterMs : undefined);
    const settled = await settleInbox(svc, row, worker, "retry", classification.reason, backoff);
    if (settled === "dead_letter") summary.inboxDeadLettered += 1;
    else summary.inboxRetried += 1;
    return;
  }

  await reportOutcome(svc, loaded.connection, "ok");

  if (resolved.revoked) {
    // The business removed our access from the provider's side.
    await disconnectAfterRevocation(svc, loaded.connection.id, loaded.connection.org_id);
    await settleInbox(svc, row, worker, "processed", "access_revoked");
    summary.inboxProcessed += 1;
    return;
  }

  const counts: Counts = {};
  const ref = { runId: null, inboxId: row.id };

  // Customer updates apply only to customers this connection already holds:
  // a connection never pulls in the provider's whole directory.
  let heldIds = new Set<string>();
  if (resolved.customers.length) {
    const { data: held, error } = await svc.rpc("rpc_integration_held_external_ids", {
      p_connection_id: loaded.connection.id,
      p_external_ids: resolved.customers.map((c) => c.externalId),
    });
    if (error) throw error;
    heldIds = new Set((held ?? []) as string[]);
  }

  await applyResolved(svc, loaded, resolved.customers, resolved.visits, heldIds, ref, counts);
  await settleInbox(svc, row, worker, "processed", counts.skipped ? "applied_with_issues" : "applied");
  summary.inboxProcessed += 1;
}

async function disconnectAfterRevocation(svc: SupabaseClient, connectionId: string, orgId: string): Promise<void> {
  const { error } = await svc.rpc("rpc_integration_begin_disconnect", {
    p_connection_id: connectionId,
    p_org_id: orgId,
    p_actor: null,
    p_reason: "provider_revoked",
  });
  if (error) throw error;
  const { error: finishError } = await svc.rpc("rpc_integration_finish_disconnect", {
    p_connection_id: connectionId,
    p_org_id: orgId,
    p_revoke_outcome: "provider_revoked",
  });
  if (finishError) throw finishError;
}

// ------------------------------------------------------------------ runs ---

interface RunRow {
  id: string;
  connection_id: string;
  org_id: string;
  stream: string;
  cursor: string | null;
  counts: Counts | null;
  window_start: string | null;
  window_end: string | null;
  attempts: number;
}

async function advanceRun(
  svc: SupabaseClient,
  run: RunRow,
  worker: string,
  deadline: number,
  summary: ProcessSummary,
): Promise<void> {
  const finish = async (status: "succeeded" | "partial" | "failed", errorCode: string | null, highWater: Date | null) => {
    const { error } = await svc.rpc("rpc_integration_finish_run", {
      p_run_id: run.id,
      p_worker: worker,
      p_status: status,
      p_error_code: errorCode,
      p_high_water: highWater?.toISOString() ?? null,
    });
    if (error) throw error;
    summary.runsFinished += 1;
  };

  let loaded;
  try {
    loaded = await loadConnection(svc, run.connection_id);
  } catch (caught) {
    if (caught instanceof ConnectionUnavailableError) return finish("failed", caught.code, null);
    if (caught instanceof ProviderError) return finish("failed", caught.classification.reason, null);
    throw caught;
  }

  const now = new Date();
  const window = {
    start: run.window_start ? new Date(run.window_start) : new Date(now.getTime() - BACKFILL_DAYS * 86_400_000),
    end: run.window_end ? new Date(run.window_end) : now,
  };
  let cursor = run.cursor;
  let highWater: Date | null = null;
  let skipped = Number(run.counts?.skipped ?? 0);

  for (;;) {
    if (Date.now() > deadline) {
      await svc.rpc("rpc_integration_yield_run", { p_run_id: run.id, p_worker: worker });
      summary.runsYielded += 1;
      return;
    }

    const counts: Counts = {};
    let next: string | null;
    try {
      const page = await loaded.adapter.fetchVisits(loaded.ctx, loaded.workflow.id, window, cursor);
      await applyVisitBatch(svc, loaded, page.items, { runId: run.id, inboxId: null }, counts);
      for (const visit of page.items) {
        const stamp = visit.sourceUpdatedAt ?? visit.occurredAt;
        if (!highWater || stamp > highWater) highWater = stamp;
      }
      next = page.next;
    } catch (caught) {
      const classification = loaded.adapter.classifyError(caught);
      await reportOutcome(svc, loaded.connection, classification);
      if (classification.kind === "retryable") {
        const { error } = await svc.rpc("rpc_integration_retry_run", {
          p_run_id: run.id,
          p_worker: worker,
          p_error_code: classification.reason,
          p_backoff_seconds: backoffSeconds(run.attempts, classification.retryAfterMs),
        });
        if (error) throw error;
        summary.runsRetried += 1;
        return;
      }
      return finish("failed", classification.reason, null);
    }

    await reportOutcome(svc, loaded.connection, "ok");
    skipped += counts.skipped ?? 0;

    const { error: checkpointError } = await svc.rpc("rpc_integration_run_checkpoint", {
      p_run_id: run.id,
      p_worker: worker,
      p_cursor: next,
      p_counts: counts,
      p_lease_seconds: RUN_LEASE_SECONDS,
    });
    if (checkpointError) throw checkpointError;

    if (!next) {
      return finish(skipped > 0 ? "partial" : "succeeded", null, highWater ?? window.end);
    }
    cursor = next;
  }
}

// ------------------------------------------------------------------ main ---

export async function processIntegrations(options?: {
  budgetMs?: number;
  worker?: string;
  now?: Date;
}): Promise<ProcessSummary> {
  const svc = serviceRoleClient();
  const worker = options?.worker ?? `integrations-${randomUUID().slice(0, 8)}`;
  const deadline = Date.now() + (options?.budgetMs ?? 40_000);
  const now = options?.now ?? new Date();
  const summary: ProcessSummary = {
    reconcilesQueued: 0,
    inboxProcessed: 0,
    inboxRetried: 0,
    inboxDeadLettered: 0,
    runsFinished: 0,
    runsYielded: 0,
    runsRetried: 0,
    purged: { profiles: 0, visits: 0, customers: 0 },
  };

  summary.reconcilesQueued = await queueDueReconciles(svc, now);

  const { data: inbox, error: inboxError } = await svc.rpc("rpc_integration_inbox_claim", {
    p_worker: worker,
    p_limit: 25,
    p_lease_seconds: INBOX_LEASE_SECONDS,
  });
  if (inboxError) throw inboxError;
  for (const row of (inbox ?? []) as InboxRow[]) {
    if (Date.now() > deadline) break; // Unfinished rows are reclaimed when their lease ends.
    try {
      await processInboxRow(svc, row, worker, summary);
    } catch (error) {
      logger.error("integrations.inbox_failed", { inboxId: row.id, error });
      await settleInbox(svc, row, worker, "retry", "internal_error", backoffSeconds(row.attempts)).catch(() => undefined);
      summary.inboxRetried += 1;
    }
  }

  const { data: runs, error: runsError } = await svc.rpc("rpc_integration_claim_runs", {
    p_worker: worker,
    p_limit: 5,
    p_lease_seconds: RUN_LEASE_SECONDS,
  });
  if (runsError) throw runsError;
  for (const run of (runs ?? []) as RunRow[]) {
    try {
      await advanceRun(svc, run, worker, deadline, summary);
    } catch (error) {
      logger.error("integrations.run_failed", { runId: run.id, error });
      await svc
        .rpc("rpc_integration_retry_run", {
          p_run_id: run.id,
          p_worker: worker,
          p_error_code: "internal_error",
          p_backoff_seconds: backoffSeconds(run.attempts),
        })
        .then(
          () => undefined,
          () => undefined,
        );
      summary.runsRetried += 1;
    }
  }

  if (Date.now() < deadline) {
    const { data: purged, error: purgeError } = await svc.rpc("rpc_integration_purge", { p_limit: 200 });
    if (purgeError) {
      logger.warn("integrations.purge_failed", { error: purgeError });
    } else {
      const row = firstRow<{ profiles_deleted: number; visits_deleted: number; customers_deleted: number }>(purged);
      summary.purged = {
        profiles: Number(row?.profiles_deleted ?? 0),
        visits: Number(row?.visits_deleted ?? 0),
        customers: Number(row?.customers_deleted ?? 0),
      };
    }
  }

  return summary;
}
