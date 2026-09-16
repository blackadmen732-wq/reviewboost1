import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { PhoneNormalizationError } from "@/lib/server/sms/phone";
import { EmailNormalizationError, toStoredCustomerEmail, toStoredCustomerPhone } from "@/lib/server/customers/normalize";
import type {
  CustomerSourceAdapter,
  CustomerSourceKind,
  ImportCounts,
  ImportRowOutcome,
  NormalizedCustomerRow,
} from "@/lib/server/customers/types";

/**
 * Customer import pipeline.
 *
 * Every source adapter (CSV today, Google Sheets / Square / Toast / Clover /
 * Vagaro / Housecall Pro later) feeds normalised rows into this one pipeline:
 *
 *   parse rows → open job (idempotent) → normalize + hash PII → validate →
 *   dedupe within batch → atomic match-or-create canonical customer (per
 *   org) → link external id → upsert visit → per-row outcome → tally
 *   real "unknown consent" against the live sms_consent_state.
 *
 * IDEMPOTENT ON RETRY, NOT REPROCESSED
 * ------------------------------------
 * `rpc_customer_import_begin` tells us whether the job already `existed`. A
 * new job runs the pipeline. A pre-existing job in a terminal state
 * (`succeeded`/`partial`/`failed`) returns the stored counts and per-row
 * outcomes without re-executing the payload — a retry never re-imports
 * customers under an old job. A pre-existing job that is still `running`
 * likewise reports back the current stored state; the caller can poll.
 *
 * FAIL SAFELY
 * -----------
 * Adapter parse errors, RPC failures, and unexpected throws all finish the
 * job as `failed` with the error recorded, so a bad upload never leaves a
 * `running` row that a later retry would resolve to.
 *
 * NEVER MINTS CONSENT
 * -------------------
 * Text Requests continues to gate every send through the merged
 * consent/suppression stack. Here we simply count how many touched phone
 * hashes have NO consent state yet, by asking the database via
 * `rpc_customer_count_known_consent`, so the count reflects reality rather
 * than a conservative upper bound.
 */

export interface ImportOptions {
  orgId: string;
  actorUserId: string | null;
  sourceKind: CustomerSourceKind;
  sourceConnectionId: string | null;
  idempotencyKey: string;
  dryRun: boolean;
  defaultCountryCallingCode?: string;
}

export interface ImportResult {
  jobId: string;
  replayed: boolean;
  status: "pending" | "running" | "succeeded" | "failed" | "partial";
  counts: ImportCounts;
  rows: ImportRowOutcome[];
}

/**
 * A structural type — the Supabase client's `rpc` signature — that lets us
 * substitute a lightweight test double without importing every generic.
 */
interface RpcClient {
  rpc<T>(name: string, args: Record<string, unknown>): Promise<{ data: T; error: unknown }>;
  from<T>(table: string): FromLike<T>;
}

interface FromLike<T> {
  select(cols: string): FromLike<T>;
  eq(col: string, value: unknown): FromLike<T>;
  order(col: string, opts?: { ascending?: boolean }): FromLike<T>;
  maybeSingle(): Promise<{ data: T | null; error: unknown }>;
  then<R>(onFulfilled: (r: { data: T[] | null; error: unknown }) => R): Promise<R>;
}

const EMPTY_COUNTS = (total: number): ImportCounts => ({
  total, imported: 0, matched: 0, duplicate: 0, invalid: 0, skipped: 0, unknownConsent: 0,
});

export async function runCustomerImport(
  client: SupabaseClient,
  adapter: CustomerSourceAdapter,
  options: ImportOptions,
): Promise<ImportResult> {
  const rpc = client as unknown as RpcClient;

  // Parse rows FIRST, before opening a job — an adapter parse failure (bad
  // CSV, oversized cell, missing mapped phone column) must not leave a
  // `running` job that a retry could resolve to. If fetch throws before we
  // have a job id, there is nothing to finalise; the error propagates up.
  let raw: NormalizedCustomerRow[];
  try {
    raw = await adapter.fetch();
  } catch (parseError) {
    throw parseError instanceof Error ? parseError : new Error("Adapter parse failed.");
  }

  const beginRes = await rpc.rpc<
    Array<{ job_id: string; existed: boolean; status: ImportResult["status"] }>
      | { job_id: string; existed: boolean; status: ImportResult["status"] }
      | null
  >("rpc_customer_import_begin", {
    p_org_id: options.orgId,
    p_source_kind: options.sourceKind,
    p_source_connection_id: options.sourceConnectionId,
    p_dry_run: options.dryRun,
    p_idempotency_key: options.idempotencyKey,
    p_actor: options.actorUserId,
  });
  if (beginRes.error || !beginRes.data) {
    throw new Error("Failed to open import job.");
  }
  const beginRow = Array.isArray(beginRes.data) ? beginRes.data[0] : beginRes.data;
  if (!beginRow) throw new Error("Import job begin returned no row.");
  const { job_id: jobId, existed, status: existingStatus } = beginRow;

  // A pre-existing job is never re-executed. Return its stored outcome so a
  // retry is a query, not a re-import.
  if (existed) {
    const replay = await loadStoredJob(rpc, options.orgId, jobId);
    return { jobId, replayed: true, status: existingStatus, ...replay };
  }

  // We opened this job; run the pipeline and always finalise on any error.
  try {
    const result = await processBatch(rpc, adapter, raw, options, jobId);
    const finishRes = await rpc.rpc("rpc_customer_import_finish", {
      p_job_id: jobId,
      p_org_id: options.orgId,
      p_total: result.counts.total,
      p_imported: result.counts.imported,
      p_matched: result.counts.matched,
      p_duplicate: result.counts.duplicate,
      p_invalid: result.counts.invalid,
      p_skipped: result.counts.skipped,
      p_unknown_consent: result.counts.unknownConsent,
      p_error: null,
    });
    if (finishRes.error) {
      throw new Error("Failed to finalise import job.");
    }
    const status: ImportResult["status"] =
      result.counts.invalid > 0 && result.counts.imported + result.counts.matched > 0
        ? "partial"
        : "succeeded";
    return { jobId, replayed: false, status, counts: result.counts, rows: result.rows };
  } catch (fatal) {
    const message = fatal instanceof Error ? fatal.message : "unknown import failure";
    // Always try to finalise the job as failed so a retry doesn't see a
    // permanently `running` row. Ignore the finalise error itself — we're
    // already throwing.
    await rpc.rpc("rpc_customer_import_finish", {
      p_job_id: jobId,
      p_org_id: options.orgId,
      p_total: raw.length,
      p_imported: 0,
      p_matched: 0,
      p_duplicate: 0,
      p_invalid: 0,
      p_skipped: 0,
      p_unknown_consent: 0,
      p_error: message.slice(0, 500),
    }).catch(() => undefined);
    throw fatal;
  }
}

interface BatchResult {
  counts: ImportCounts;
  rows: ImportRowOutcome[];
}

async function processBatch(
  rpc: RpcClient,
  _adapter: CustomerSourceAdapter,
  raw: NormalizedCustomerRow[],
  options: ImportOptions,
  jobId: string,
): Promise<BatchResult> {
  const counts = EMPTY_COUNTS(raw.length);
  const rows: ImportRowOutcome[] = [];

  // Within-batch dedupe by phone hash: the same phone appearing twice in one
  // upload counts as a duplicate on the second occurrence, not two inserts.
  const seenPhoneHashes = new Map<string, number>();
  // Phone hashes we imported OR matched; used at the end to count "unknown
  // consent" honestly against sms_consent_state, not as a blanket upper bound.
  const touchedPhoneHashes = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const rowNumber = i + 1;
    const row = raw[i]!;
    const outcome = await processRow(rpc, row, rowNumber, options, jobId, seenPhoneHashes, touchedPhoneHashes);
    rows.push(outcome);
    counts[outcome.action] += 1;
  }

  // Real unknown-consent tally: how many touched phones have NO consent row
  // for this org? A conservative fallback (equal to touched size) is used
  // when the count RPC fails so the caller never sees a smaller number than
  // reality could support.
  if (touchedPhoneHashes.size > 0 && !options.dryRun) {
    const hashes = [...touchedPhoneHashes];
    const consentRes = await rpc.rpc<number>("rpc_customer_count_known_consent", {
      p_org_id: options.orgId,
      p_phone_hashes: hashes,
    });
    if (!consentRes.error && typeof consentRes.data === "number") {
      const known = consentRes.data;
      counts.unknownConsent = Math.max(0, hashes.length - known);
    } else {
      counts.unknownConsent = hashes.length; // conservative fallback
    }
  }

  return { counts, rows };
}

async function processRow(
  rpc: RpcClient,
  row: NormalizedCustomerRow,
  rowNumber: number,
  options: ImportOptions,
  jobId: string,
  seenPhoneHashes: Map<string, number>,
  touchedPhoneHashes: Set<string>,
): Promise<ImportRowOutcome> {
  const record = async (
    action: ImportRowOutcome["action"],
    matchedCustomerId: string | null,
    externalId: string | null,
    error: string | null,
  ): Promise<ImportRowOutcome> => {
    if (!options.dryRun) {
      const res = await rpc.rpc("rpc_customer_import_record_row", {
        p_job_id: jobId,
        p_org_id: options.orgId,
        p_row_number: rowNumber,
        p_action: action,
        p_matched_customer_id: matchedCustomerId,
        p_external_id: externalId,
        p_error: error,
      });
      if (res.error) throw new Error("Failed to record import row.");
    }
    return { rowNumber, action, externalId, matchedCustomerId, error };
  };

  if (!row.rawPhone) {
    return record("invalid", null, row.externalId, "Missing phone number.");
  }

  let phone;
  try {
    phone = toStoredCustomerPhone(row.rawPhone, options.defaultCountryCallingCode);
  } catch (e) {
    if (e instanceof PhoneNormalizationError) {
      return record("invalid", null, row.externalId, e.message);
    }
    return record("invalid", null, row.externalId, "Invalid phone number.");
  }

  let email: ReturnType<typeof toStoredCustomerEmail> | null = null;
  if (row.rawEmail) {
    try {
      email = toStoredCustomerEmail(row.rawEmail);
    } catch (e) {
      if (e instanceof EmailNormalizationError) {
        email = null;
      } else {
        return record("invalid", null, row.externalId, "Invalid email.");
      }
    }
  }

  const priorRow = seenPhoneHashes.get(phone.phoneHash);
  if (priorRow !== undefined) {
    return record("duplicate", null, row.externalId, `Duplicate of row ${priorRow} in this upload.`);
  }
  seenPhoneHashes.set(phone.phoneHash, rowNumber);

  if (options.dryRun) {
    return record("skipped", null, row.externalId, null);
  }

  const upsertRes = await rpc.rpc<
    Array<{ customer_id: string; matched: boolean }> | { customer_id: string; matched: boolean } | null
  >("rpc_customer_upsert_by_phone", {
    p_org_id: options.orgId,
    p_phone_hash: phone.phoneHash,
    p_phone_encrypted: phone.phoneEncrypted,
    p_phone_key_version: phone.phoneKeyVersion,
    p_phone_last_four: phone.phoneLastFour,
    p_display_name: row.displayName,
    p_email_hash: email?.emailHash ?? null,
    p_email_encrypted: email?.emailEncrypted ?? null,
    p_email_key_version: email?.emailKeyVersion ?? null,
    p_email_domain: email?.emailDomain ?? null,
  });
  if (upsertRes.error) {
    return record("invalid", null, row.externalId, "Failed to upsert customer.");
  }
  const record0 = Array.isArray(upsertRes.data) ? upsertRes.data[0] : upsertRes.data;
  if (!record0) return record("invalid", null, row.externalId, "Customer upsert returned no row.");
  const customerId = record0.customer_id;
  const matched = record0.matched;
  touchedPhoneHashes.add(phone.phoneHash);

  if (row.externalId) {
    const linkRes = await rpc.rpc("rpc_customer_external_link", {
      p_org_id: options.orgId,
      p_customer_id: customerId,
      p_source_kind: options.sourceKind,
      p_source_connection_id: options.sourceConnectionId,
      p_external_id: row.externalId,
      p_metadata: row.meta,
    });
    if (linkRes.error) {
      return record("invalid", customerId, row.externalId, "Failed to link external id.");
    }
  }

  // Persist the observed visit when the source supplied a timestamp. Without
  // this the mapped `observedAt` would be silently dropped and cross-source
  // resync dedupe (unique on (org, source_kind, external_id)) would have no
  // basis. When no external_id is present the (nulls-not-distinct) unique
  // constraint permits at most one null-external visit per (org, source).
  if (row.observedAt) {
    const visitRes = await rpc.rpc("rpc_customer_visit_upsert", {
      p_org_id: options.orgId,
      p_customer_id: customerId,
      p_source_kind: options.sourceKind,
      p_external_id: row.externalId,
      p_occurred_at: row.observedAt.toISOString(),
      p_note_encrypted: null,
      p_meta: row.meta,
    });
    if (visitRes.error) {
      return record("invalid", customerId, row.externalId, "Failed to record visit.");
    }
  }

  return record(matched ? "matched" : "imported", customerId, row.externalId, null);
}

/**
 * Load the stored outcome of a previously-run job so a retried
 * `runCustomerImport` returns the same result instead of re-executing.
 * Reads counts from `customer_import_jobs` and per-row outcomes from
 * `customer_import_rows`; both are org-scoped by construction.
 */
async function loadStoredJob(
  rpc: RpcClient,
  orgId: string,
  jobId: string,
): Promise<{ counts: ImportCounts; rows: ImportRowOutcome[] }> {
  const jobRes = await rpc
    .from<{
      total_rows: number;
      imported_count: number;
      matched_count: number;
      duplicate_count: number;
      invalid_count: number;
      skipped_count: number;
      unknown_consent_count: number;
    }>("customer_import_jobs")
    .select("total_rows, imported_count, matched_count, duplicate_count, invalid_count, skipped_count, unknown_consent_count")
    .eq("id", jobId)
    .eq("org_id", orgId)
    .maybeSingle();
  const rowsRes = await rpc
    .from<{
      row_number: number;
      action: ImportRowOutcome["action"];
      matched_customer_id: string | null;
      external_id: string | null;
      error: string | null;
    }>("customer_import_rows")
    .select("row_number, action, matched_customer_id, external_id, error")
    .eq("job_id", jobId)
    .eq("org_id", orgId)
    .order("row_number", { ascending: true });

  const counts: ImportCounts = jobRes.data
    ? {
        total: jobRes.data.total_rows,
        imported: jobRes.data.imported_count,
        matched: jobRes.data.matched_count,
        duplicate: jobRes.data.duplicate_count,
        invalid: jobRes.data.invalid_count,
        skipped: jobRes.data.skipped_count,
        unknownConsent: jobRes.data.unknown_consent_count,
      }
    : EMPTY_COUNTS(0);

  const rows: ImportRowOutcome[] = (rowsRes.data ?? []).map((r) => ({
    rowNumber: r.row_number,
    action: r.action,
    matchedCustomerId: r.matched_customer_id,
    externalId: r.external_id,
    error: r.error,
  }));

  return { counts, rows };
}
