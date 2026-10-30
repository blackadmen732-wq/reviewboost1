import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { encrypt, keyedDigest } from "@/lib/server/crypto";
import { tokenDigestKey } from "@/lib/server/env";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { cleanName, nameDigest, normalizeListPhone } from "@/lib/server/integrations/normalize";
import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";

/**
 * Bringing in a customer list the business already keeps (a Google Sheet).
 *
 * The browser reads the sheet with a token the owner granted for that one
 * file and sends the rows here; no Google credential ever reaches the server.
 * Each row's phone is normalised strictly (a guessed number texts a stranger),
 * stored as a keyed digest plus ciphertext, and becomes a phone-keyed contact.
 *
 * Importing never records consent. A list makes people findable in
 * ReviewBoost; whether they may be texted is still decided only by the consent
 * ledger (docs/connections/07).
 */

export const MAX_LIST_ROWS = 2000;
/** 2,000 rows of a name and a phone, with room for JSON punctuation. */
export const MAX_LIST_BODY_BYTES = 400 * 1024;

const rowSchema = z.strictObject({
  /** The row's number in the sheet, so the owner can find a row we could not use. */
  row: z.number().int().min(1).max(1_000_000),
  name: z.string().max(200).nullable(),
  phone: z.string().max(40).nullable(),
});

const labelSchema = z.string().trim().min(1).max(120);
const rowsSchema = z.array(rowSchema).max(MAX_LIST_ROWS);

export const listImportSchema = z.discriminatedUnion("source", [
  z.strictObject({
    source: z.literal("google_sheets"),
    /** The sheet's title as the owner sees it. */
    label: labelSchema,
    /** Google's id for the file. Only a keyed digest of it is kept. */
    sourceRef: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/),
    rows: rowsSchema,
  }),
  z.strictObject({
    /** A CSV file read in the owner's browser. Only its name is kept. */
    source: z.literal("csv"),
    label: labelSchema,
    rows: rowsSchema,
  }),
]);

export type ListSourceKind = ListImportInput["source"];

export type ListImportInput = z.infer<typeof listImportSchema>;

export type UnusableReason = "no_phone" | "invalid_phone";

export interface ListImportResult {
  importId: string;
  created: number;
  updated: number;
  unchanged: number;
  /** Rows we could not use, by sheet row number. The first 50 only. */
  unusable: Array<{ row: number; reason: UnusableReason }>;
  unusableCount: number;
}

interface PreparedRow {
  phone_hash: string;
  phone_encrypted: string | null;
  phone_key_version: number;
  phone_last_four: string;
  name_encrypted: string | null;
  name_digest: string | null;
}

/** Pure part of an import: which rows are usable, and their stored form. */
export function prepareRows(rows: ListImportInput["rows"]): {
  prepared: PreparedRow[];
  unusable: Array<{ row: number; reason: UnusableReason }>;
} {
  const prepared: PreparedRow[] = [];
  const unusable: Array<{ row: number; reason: UnusableReason }> = [];
  for (const row of rows) {
    const phone = normalizeListPhone(row.phone);
    if (phone.kind !== "ok") {
      unusable.push({ row: row.row, reason: phone.kind === "missing" ? "no_phone" : "invalid_phone" });
      continue;
    }
    const name = cleanName(row.name);
    prepared.push({
      phone_hash: phone.stored.phoneHash,
      phone_encrypted: phone.stored.phoneEncrypted,
      phone_key_version: phone.stored.phoneKeyVersion,
      phone_last_four: phone.stored.lastFour,
      name_encrypted: name ? encrypt(name) : null,
      name_digest: name ? nameDigest(name) : null,
    });
  }
  return { prepared, unusable };
}

export function sourceRefDigest(sourceRef: string): string {
  return keyedDigest(sourceRef, "customer_list_source", tokenDigestKey());
}

export async function importCustomerList(
  orgId: string,
  actorId: string,
  input: ListImportInput,
  requestId: string,
): Promise<ListImportResult> {
  if (input.rows.length === 0) {
    throw new ApiError(400, ERROR_CODE.validationFailed, "That sheet has no rows to bring in.");
  }
  const { prepared, unusable } = prepareRows(input.rows);

  const { data, error } = await serviceRoleClient().rpc("rpc_customer_list_import", {
    p_org_id: orgId,
    p_actor: actorId,
    p_source: input.source,
    p_label: input.label,
    p_ref_digest: input.source === "google_sheets" ? sourceRefDigest(input.sourceRef) : null,
    p_rows_received: input.rows.length,
    p_rows_unusable: unusable.length,
    p_rows: prepared,
  });
  if (error) {
    if (error.code === "P0002") throw new ApiError(404, ERROR_CODE.notFound, "That business was not found.");
    logger.error("customer_list.import_failed", { requestId, code: error.code });
    throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Your list wasn't brought in. Please try again.");
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { import_id: string; created_count: number; updated_count: number; unchanged_count: number }
    | undefined;
  if (!row) {
    logger.error("customer_list.import_no_result", { requestId });
    throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Your list wasn't brought in. Please try again.");
  }

  return {
    importId: row.import_id,
    created: row.created_count,
    updated: row.updated_count,
    unchanged: row.unchanged_count,
    unusable: unusable.slice(0, 50),
    unusableCount: unusable.length,
  };
}

export async function removeCustomerList(
  orgId: string,
  actorId: string,
  importId: string,
  requestId: string,
): Promise<{ contactsRemoved: number }> {
  const { data, error } = await serviceRoleClient().rpc("rpc_customer_list_remove", {
    p_org_id: orgId,
    p_actor: actorId,
    p_import_id: importId,
  });
  if (error) {
    if (error.code === "P0002") throw new ApiError(404, ERROR_CODE.notFound, "That list was not found.");
    logger.error("customer_list.remove_failed", { requestId, code: error.code });
    throw new ApiError(503, ERROR_CODE.serviceUnavailable, "The list wasn't removed. Please try again.");
  }
  return { contactsRemoved: typeof data === "number" ? data : 0 };
}

export interface ListImportSummary {
  id: string;
  label: string | null;
  createdAt: string;
  rowsReceived: number;
  rowsUnusable: number;
  created: number;
  updated: number;
  unchanged: number;
}

/** Live (not removed) imports, newest first, read through the caller's RLS. */
export async function listCustomerLists(
  db: SupabaseClient,
  orgId: string,
  requestId: string,
  source: ListSourceKind = "google_sheets",
): Promise<ListImportSummary[]> {
  const { data, error } = await db
    .from("customer_list_imports")
    .select("id, source_label, created_at, rows_received, rows_unusable, created_count, updated_count, unchanged_count")
    .eq("org_id", orgId)
    .eq("source", source)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    logger.error("customer_list.list_failed", { requestId, code: error.code });
    throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Your lists couldn't be loaded. Please try again.");
  }
  return (
    (data ?? []) as Array<{
      id: string;
      source_label: string | null;
      created_at: string;
      rows_received: number;
      rows_unusable: number;
      created_count: number;
      updated_count: number;
      unchanged_count: number;
    }>
  ).map((row) => ({
    id: row.id,
    label: row.source_label,
    createdAt: row.created_at,
    rowsReceived: row.rows_received,
    rowsUnusable: row.rows_unusable,
    created: row.created_count,
    updated: row.updated_count,
    unchanged: row.unchanged_count,
  }));
}
