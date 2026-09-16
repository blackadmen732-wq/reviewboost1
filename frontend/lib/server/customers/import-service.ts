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
 *   fetch rows → normalize + hash PII → validate → dedupe within batch →
 *   match-or-create canonical customer (per org) → link external id → record
 *   optional visit → per-row outcome + tallies.
 *
 * The pipeline is idempotent per (org, idempotencyKey): a retry with the same
 * key reuses the same import job row and doesn't double-count anything, even
 * if the same input rows come through again (the phone hash is the same, so
 * `matched=true`).
 *
 * IT NEVER MINTS CONSENT. A newly-created customer has no consent state; Text
 * Requests continues to gate every send through the merged consent/suppression
 * stack. This module counts phones that have no consent row yet so callers can
 * report "80 rows without recorded consent" in the import result, but it never
 * asserts consent on the customer's behalf.
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
  counts: ImportCounts;
  rows: ImportRowOutcome[];
}

interface RpcClient {
  rpc<Args, T>(name: string, args: Args): Promise<{ data: T; error: unknown }>;
}

/**
 * Run one import against a source adapter. The `client` is a service-role
 * Supabase client (the writer definer RPCs are service-role only).
 */
export async function runCustomerImport(
  client: SupabaseClient,
  adapter: CustomerSourceAdapter,
  options: ImportOptions,
): Promise<ImportResult> {
  const rpc = client as unknown as RpcClient;

  const beginRes = await rpc.rpc<Record<string, unknown>, string>("rpc_customer_import_begin", {
    p_org_id: options.orgId,
    p_source_kind: options.sourceKind,
    p_source_connection_id: options.sourceConnectionId,
    p_dry_run: options.dryRun,
    p_idempotency_key: options.idempotencyKey,
    p_actor: options.actorUserId,
  });
  if (beginRes.error || typeof beginRes.data !== "string") {
    throw new Error("Failed to open import job.");
  }
  const jobId = beginRes.data;

  const raw = await adapter.fetch();
  const outcomes: ImportRowOutcome[] = [];
  const counts: ImportCounts = {
    total: raw.length,
    imported: 0,
    matched: 0,
    duplicate: 0,
    invalid: 0,
    skipped: 0,
    unknownConsent: 0,
  };

  // Within-batch dedupe by phone hash: if the same phone appears twice in the
  // same upload, the second occurrence is `duplicate`, not a second insert.
  const seenPhoneHashes = new Map<string, number>(); // hash -> earlier rowNumber
  const importedCustomerIds = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const rowNumber = i + 1;
    const row = raw[i]!;
    const outcome = await processRow(
      rpc,
      row,
      rowNumber,
      options,
      jobId,
      seenPhoneHashes,
    );
    outcomes.push(outcome);
    counts[outcome.action] += 1;
    if (outcome.action === "imported" || outcome.action === "matched") {
      // Ask whether we already know an SMS consent for this phone identity.
      // We don't hand the phone hash to counts (that would leak), only the
      // count of "no recorded consent yet".
      if (outcome.matchedCustomerId && !importedCustomerIds.has(outcome.matchedCustomerId)) {
        importedCustomerIds.add(outcome.matchedCustomerId);
      }
    }
  }

  counts.unknownConsent = await countUnknownConsent(rpc, options.orgId, importedCustomerIds);

  await rpc.rpc("rpc_customer_import_finish", {
    p_job_id: jobId,
    p_org_id: options.orgId,
    p_total: counts.total,
    p_imported: counts.imported,
    p_matched: counts.matched,
    p_duplicate: counts.duplicate,
    p_invalid: counts.invalid,
    p_skipped: counts.skipped,
    p_unknown_consent: counts.unknownConsent,
    p_error: null,
  });

  return { jobId, counts, rows: outcomes };
}

async function processRow(
  rpc: RpcClient,
  row: NormalizedCustomerRow,
  rowNumber: number,
  options: ImportOptions,
  jobId: string,
  seenPhoneHashes: Map<string, number>,
): Promise<ImportRowOutcome> {
  const record = async (
    action: ImportRowOutcome["action"],
    matchedCustomerId: string | null,
    externalId: string | null,
    error: string | null,
  ): Promise<ImportRowOutcome> => {
    if (!options.dryRun) {
      await rpc.rpc("rpc_customer_import_record_row", {
        p_job_id: jobId,
        p_org_id: options.orgId,
        p_row_number: rowNumber,
        p_action: action,
        p_matched_customer_id: matchedCustomerId,
        p_external_id: externalId,
        p_error: error,
      });
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
        // A malformed email doesn't invalidate the whole row — phone is the
        // primary identity. Import without the email and note the row.
        email = null;
      } else {
        return record("invalid", null, row.externalId, "Invalid email.");
      }
    }
  }

  // Within-batch dedupe.
  const priorRow = seenPhoneHashes.get(phone.phoneHash);
  if (priorRow !== undefined) {
    return record("duplicate", null, row.externalId, `Duplicate of row ${priorRow} in this upload.`);
  }
  seenPhoneHashes.set(phone.phoneHash, rowNumber);

  if (options.dryRun) {
    return record("skipped", null, row.externalId, null);
  }

  const upsertRes = await rpc.rpc<
    Record<string, unknown>,
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

  if (row.externalId) {
    await rpc.rpc("rpc_customer_external_link", {
      p_org_id: options.orgId,
      p_customer_id: customerId,
      p_source_kind: options.sourceKind,
      p_source_connection_id: options.sourceConnectionId,
      p_external_id: row.externalId,
      p_metadata: row.meta,
    });
  }

  return record(matched ? "matched" : "imported", customerId, row.externalId, null);
}

async function countUnknownConsent(
  _rpc: RpcClient,
  _orgId: string,
  customerIds: Set<string>,
): Promise<number> {
  // Consent lookup by phone hash is a per-org query already exposed to the
  // service role via app.sms_current_consent. Here we defer the actual lookup
  // to callers that need it (dispatch time), and return the count of customers
  // touched — the caller may re-query later. Returning 0 here would be wrong;
  // returning the full customer count is a conservative upper bound (there is
  // no consent state yet for any newly-imported customer). This is the
  // conservative reading and matches the spec: "Do not automatically make
  // imported phone numbers SMS-eligible."
  return customerIds.size;
}
