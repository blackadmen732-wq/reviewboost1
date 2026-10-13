import "server-only";

import { z } from "zod";

import type { OrganizationContext } from "@/lib/server/auth";
import { KEY_VERSION, decrypt, encrypt } from "@/lib/server/crypto";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { cleanName, nameDigest } from "@/lib/server/integrations/normalize";
import { logger } from "@/lib/server/logger";
import { parseOwnerPhone } from "@/lib/server/sms/phone-input";
import { toStoredPhone } from "@/lib/server/sms/phone";
import {
  CUSTOMER_NAME_MAX,
  customerConsentState,
  type CustomerConsentState,
} from "@/lib/owner/customers";

/**
 * Customers: everyone this business can send a Text Request to, in the one
 * customer model (PR #76's `customers`, `customer_source_profiles`,
 * `customer_visits`). A customer is one reachable phone number per business;
 * each source that knows them (the owner by hand, Square, …) has its own
 * profile, and visits come from connected apps.
 *
 * This module owns what an owner does by hand: add, rename, change the number
 * of a customer nothing else knows, remove what they added, export. Connected
 * apps write through the integrations pipeline, never through here.
 *
 * Names and numbers are encrypted here before they reach the database, and
 * decrypted only here. The list the browser receives carries a name and the
 * last four digits, never a whole number; a whole number leaves the server
 * only in an owner's export, which is recorded, or inside a Text Request the
 * server sends itself.
 *
 * Saving a customer is not consent. The list shows what the consent ledger
 * says; nothing here writes to it.
 */

export const saveCustomerSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .max(CUSTOMER_NAME_MAX, `Keep the name under ${CUSTOMER_NAME_MAX} characters.`)
    .optional()
    .nullable(),
  phone: z.string().min(3).max(40),
});

/** An edit may leave the number as it was: the browser never had it. */
export const updateCustomerSchema = saveCustomerSchema.extend({
  phone: z.string().min(3).max(40).optional(),
});

export type SaveCustomerInput = z.infer<typeof saveCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export interface CustomerListItem {
  id: string;
  name: string | null;
  /** Two sources call this number by different names; shown, never resolved. */
  namesDiffer: boolean;
  lastFour: string;
  /** Who knows this customer: "manual", or a provider id such as "square". */
  sources: string[];
  /** Whether the owner added them by hand (and so can edit or remove that). */
  addedByHand: boolean;
  consent: CustomerConsentState;
  lastVisitAt: string | null;
  lastVisitKind: "payment" | "appointment" | null;
  lastVisitLocationId: string | null;
  lastRequestStatus: string | null;
  lastRequestAt: string | null;
  createdAt: string;
}

interface CustomerRow {
  id: string;
  name_encrypted: string | null;
  names_differ: boolean | null;
  phone_encrypted: string | null;
  phone_last_four: string | null;
  has_manual: boolean | null;
  sources: string[] | null;
  consent_status: string | null;
  last_visit_at: string | null;
  last_visit_kind: string | null;
  last_visit_location: string | null;
  last_request_status: string | null;
  last_request_at: string | null;
  created_at: string;
}

/** A name that will not decrypt is shown as missing, not as an error page. */
function readName(row: CustomerRow, requestId: string): string | null {
  try {
    return decrypt(row.name_encrypted);
  } catch {
    logger.warn("customers.name_decrypt_failed", { requestId, customerId: row.id });
    return null;
  }
}

async function readRows(context: OrganizationContext): Promise<CustomerRow[]> {
  const { data, error } = await context.db.rpc("rpc_customers_list", { p_org_id: context.orgId });
  if (error) throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
  return (data ?? []) as CustomerRow[];
}

export async function listCustomers(
  context: OrganizationContext,
  requestId: string,
): Promise<CustomerListItem[]> {
  const rows = await readRows(context);
  return rows.map((row) => ({
    id: row.id,
    name: readName(row, requestId),
    namesDiffer: row.names_differ === true,
    lastFour: row.phone_last_four ?? "????",
    sources: row.sources ?? [],
    addedByHand: row.has_manual === true,
    consent: customerConsentState(row.consent_status),
    lastVisitAt: row.last_visit_at,
    lastVisitKind:
      row.last_visit_kind === "payment" || row.last_visit_kind === "appointment" ? row.last_visit_kind : null,
    lastVisitLocationId: row.last_visit_location,
    lastRequestStatus: row.last_request_status,
    lastRequestAt: row.last_request_at,
    createdAt: row.created_at,
  }));
}

const SAVE_ERRORS: Record<string, { status: number; field?: string; message: string }> = {
  contact_exists: { status: 409, field: "phone", message: "That number is already saved." },
  phone_from_source: {
    status: 409,
    field: "phone",
    message: "This number comes from a connected app. Change it there, and it updates here.",
  },
  invalid_phone: { status: 400, field: "phone", message: "Enter a mobile number with its country code." },
  not_found_or_forbidden: { status: 404, message: "Not found." },
};

function mapSaveError(error: { message?: string } | null, requestId: string): ApiError {
  const message = error?.message ?? "";
  for (const [code, mapped] of Object.entries(SAVE_ERRORS)) {
    if (message.includes(code)) {
      return new ApiError(
        mapped.status,
        mapped.status === 404 ? ERROR_CODE.notFound : ERROR_CODE.validationFailed,
        mapped.message,
        mapped.field ? { details: [{ field: mapped.field, message: mapped.message }] } : undefined,
      );
    }
  }
  logger.error("customers.save_failed", { requestId, error });
  return new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
}

interface StoredRecipient {
  phoneHash: string;
  phoneEncrypted: string;
  phoneKeyVersion: number;
  lastFour: string;
}

function storePhone(raw: string): StoredRecipient {
  const stored = toStoredPhone(parseOwnerPhone(raw));
  if (!stored.phoneEncrypted) {
    // encrypt() only returns null for empty input; a normalised number is never
    // empty. Refuse rather than save a customer nobody can text.
    throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
  }
  return { ...stored, phoneEncrypted: stored.phoneEncrypted };
}

function sealName(raw: string | null | undefined): { encrypted: string | null; digest: string | null } {
  const name = cleanName(raw);
  return name ? { encrypted: encrypt(name), digest: nameDigest(name) } : { encrypted: null, digest: null };
}

async function save(
  context: OrganizationContext,
  customerId: string | null,
  name: string | null | undefined,
  phone: StoredRecipient | null,
  requestId: string,
): Promise<{ id: string; outcome: string }> {
  const sealed = sealName(name);
  const { data, error } = await context.db.rpc("rpc_customer_manual_save", {
    p_org_id: context.orgId,
    p_customer_id: customerId,
    p_name_encrypted: sealed.encrypted,
    p_name_digest: sealed.digest,
    p_phone_hash: phone?.phoneHash ?? null,
    p_phone_encrypted: phone?.phoneEncrypted ?? null,
    p_phone_key_version: phone?.phoneKeyVersion ?? KEY_VERSION,
    p_phone_last_four: phone?.lastFour ?? null,
    p_request_id: requestId,
  });
  if (error) throw mapSaveError(error, requestId);
  const row = (Array.isArray(data) ? data[0] : data) as { customer_id: string; outcome: string } | null;
  if (!row?.customer_id) throw mapSaveError(null, requestId);
  return { id: row.customer_id, outcome: row.outcome };
}

/**
 * Add someone by hand. A number a connected app already knows becomes the
 * same customer with the owner's name added ("linked"), never a duplicate.
 */
export async function createCustomer(
  context: OrganizationContext,
  input: SaveCustomerInput,
  requestId: string,
): Promise<{ id: string; lastFour: string; linked: boolean }> {
  const phone = storePhone(input.phone);
  const saved = await save(context, null, input.name, phone, requestId);
  return { id: saved.id, lastFour: phone.lastFour, linked: saved.outcome === "linked" };
}

/** Rename, or change the number of a customer only the owner knows. */
export async function updateCustomer(
  context: OrganizationContext,
  customerId: string,
  input: UpdateCustomerInput,
  requestId: string,
): Promise<{ id: string }> {
  const phone = input.phone ? storePhone(input.phone) : null;
  const saved = await save(context, customerId, input.name, phone, requestId);
  return { id: saved.id };
}

/**
 * Remove what the owner added. A customer a connected app still knows stays,
 * without the owner's name; consent history and past texts always stay.
 */
export async function deleteCustomer(
  context: OrganizationContext,
  customerId: string,
  requestId: string,
): Promise<{ outcome: "deleted" | "kept_from_source" }> {
  const { data, error } = await context.db.rpc("rpc_customer_manual_delete", {
    p_org_id: context.orgId,
    p_customer_id: customerId,
    p_request_id: requestId,
  });
  if (error) throw mapSaveError(error, requestId);
  if (data === "deleted" || data === "kept_from_source") return { outcome: data };
  throw new ApiError(404, ERROR_CODE.notFound, "That customer was not found.");
}

/**
 * The whole number for one of this business's customers, for the server's
 * own use when it sends a Text Request. Read through the caller's RLS (owner
 * or admin of this business). Never returned to a browser.
 */
export async function customerPhone(context: OrganizationContext, customerId: string): Promise<string> {
  const { data, error } = await context.db
    .from("customers")
    .select("phone_encrypted")
    .eq("org_id", context.orgId)
    .eq("id", customerId)
    .maybeSingle();
  if (error) throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
  if (!data) throw new ApiError(404, ERROR_CODE.notFound, "That customer was not found.");
  let phone: string | null = null;
  try {
    phone = decrypt((data as { phone_encrypted: string | null }).phone_encrypted);
  } catch {
    phone = null;
  }
  if (!phone) {
    throw new ApiError(409, ERROR_CODE.validationFailed, "This customer's number can't be read. Save it again.");
  }
  return phone;
}

/** RFC 4180 field: quoted, with quotes doubled. */
function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Free text (a name, from the owner or a connected app) could start a
 * spreadsheet formula, so a leading = + - @ is neutralised. A stored number is
 * E.164, digits after a plus, and is left exactly as it is.
 */
function csvText(value: string): string {
  return csvField(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
}

/**
 * The business's own list as CSV: name, number, where they came from, texting
 * permission, last visit. Recorded in the audit log with a count before it is
 * returned.
 */
export async function exportCustomers(
  context: OrganizationContext,
  requestId: string,
): Promise<{ csv: string; count: number }> {
  const rows = await readRows(context);

  const lines = [
    ["Name", "Mobile number", "From", "Texting permission", "Last visit"].map(csvField).join(","),
  ];
  for (const row of rows) {
    let phone = "";
    try {
      phone = decrypt(row.phone_encrypted) ?? "";
    } catch {
      logger.warn("customers.phone_decrypt_failed", { requestId, customerId: row.id });
    }
    lines.push(
      [
        csvText(readName(row, requestId) ?? ""),
        csvField(/^\+[0-9]{6,15}$/.test(phone) ? phone : ""),
        csvField((row.sources ?? []).join(" + ")),
        csvField(customerConsentState(row.consent_status).label),
        csvField(row.last_visit_at ? row.last_visit_at.slice(0, 10) : ""),
      ].join(","),
    );
  }

  const { error } = await context.db.rpc("rpc_customers_record_export", {
    p_org_id: context.orgId,
    p_count: rows.length,
    p_request_id: requestId,
  });
  if (error) {
    // No record, no export: a list of numbers should not leave unaccounted for.
    logger.error("customers.export_audit_failed", { requestId, error });
    throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
  }

  return { csv: `${lines.join("\r\n")}\r\n`, count: rows.length };
}
