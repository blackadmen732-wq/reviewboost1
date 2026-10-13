import "server-only";

import { z } from "zod";

import type { OrganizationContext } from "@/lib/server/auth";
import { KEY_VERSION, decrypt, encrypt } from "@/lib/server/crypto";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { logger } from "@/lib/server/logger";
import { parseOwnerPhone } from "@/lib/server/sms/phone-input";
import { toStoredPhone } from "@/lib/server/sms/phone";
import { uuidSchema } from "@/lib/server/validation";
import {
  CUSTOMER_NAME_MAX,
  customerConsentState,
  type CustomerConsentState,
} from "@/lib/owner/customers";

/**
 * Customers: the people a business saved so it can send a Text Request
 * without retyping a number.
 *
 * Names and numbers are encrypted here before they reach the database, and
 * decrypted only here. The list the browser receives carries a name and the
 * last four digits, never a whole number; a whole number leaves the server only
 * in an owner's export, which is recorded, or inside a Text Request the server
 * sends itself.
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
  locationId: uuidSchema("Choose a place.").optional().nullable(),
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
  lastFour: string;
  locationId: string | null;
  consent: CustomerConsentState;
  lastRequestStatus: string | null;
  lastRequestAt: string | null;
  createdAt: string;
}

interface CustomerRow {
  id: string;
  location_id: string | null;
  name_encrypted: string | null;
  phone_encrypted: string;
  phone_last_four: string;
  consent_status: string | null;
  last_request_status: string | null;
  last_request_at: string | null;
  created_at: string;
}

function cleanName(raw: string | null | undefined): string | null {
  const name = (raw ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  return name === "" ? null : name;
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
  const { data, error } = await context.db.rpc("rpc_customer_contacts_list", {
    p_org_id: context.orgId,
  });
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
    lastFour: row.phone_last_four,
    locationId: row.location_id,
    consent: customerConsentState(row.consent_status),
    lastRequestStatus: row.last_request_status,
    lastRequestAt: row.last_request_at,
    createdAt: row.created_at,
  }));
}

function mapSaveError(error: { message?: string } | null, requestId: string): ApiError {
  const message = error?.message ?? "";
  if (message.includes("contact_exists")) {
    return new ApiError(409, ERROR_CODE.validationFailed, "That number is already saved.", {
      details: [{ field: "phone", message: "That number is already saved." }],
    });
  }
  if (message.includes("not_found_or_forbidden")) {
    return new ApiError(404, ERROR_CODE.notFound, "Not found.");
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

export async function createCustomer(
  context: OrganizationContext,
  input: SaveCustomerInput,
  requestId: string,
): Promise<{ id: string; lastFour: string }> {
  const phone = storePhone(input.phone);
  const name = cleanName(input.name);

  const { data, error } = await context.db.rpc("rpc_customer_contact_save", {
    p_org_id: context.orgId,
    p_contact_id: null,
    p_location_id: input.locationId ?? null,
    p_name_encrypted: encrypt(name),
    p_name_key_version: KEY_VERSION,
    p_phone_hash: phone.phoneHash,
    p_phone_encrypted: phone.phoneEncrypted,
    p_phone_key_version: phone.phoneKeyVersion,
    p_phone_last_four: phone.lastFour,
    p_request_id: requestId,
  });
  if (error) throw mapSaveError(error, requestId);

  const row = (Array.isArray(data) ? data[0] : data) as { contact_id: string } | null;
  if (!row?.contact_id) throw mapSaveError(null, requestId);
  return { id: row.contact_id, lastFour: phone.lastFour };
}

/** The stored number for one of this business's customers, readable only here. */
async function readStoredCustomer(
  context: OrganizationContext,
  customerId: string,
): Promise<{ phoneHash: string; phoneEncrypted: string; phoneKeyVersion: number; lastFour: string }> {
  const { data, error } = await context.db
    .from("customer_contacts")
    .select("phone_hash, phone_encrypted, phone_key_version, phone_last_four")
    .eq("org_id", context.orgId)
    .eq("id", customerId)
    .maybeSingle();
  if (error) throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
  if (!data) throw new ApiError(404, ERROR_CODE.notFound, "That customer was not found.");
  return {
    phoneHash: data.phone_hash as string,
    phoneEncrypted: data.phone_encrypted as string,
    phoneKeyVersion: data.phone_key_version as number,
    lastFour: data.phone_last_four as string,
  };
}

export async function updateCustomer(
  context: OrganizationContext,
  customerId: string,
  input: UpdateCustomerInput,
  requestId: string,
): Promise<{ id: string; lastFour: string }> {
  const phone = input.phone ? storePhone(input.phone) : await readStoredCustomer(context, customerId);
  const name = cleanName(input.name);

  const { data, error } = await context.db.rpc("rpc_customer_contact_save", {
    p_org_id: context.orgId,
    p_contact_id: customerId,
    p_location_id: input.locationId ?? null,
    p_name_encrypted: encrypt(name),
    p_name_key_version: KEY_VERSION,
    p_phone_hash: phone.phoneHash,
    p_phone_encrypted: phone.phoneEncrypted,
    p_phone_key_version: phone.phoneKeyVersion,
    p_phone_last_four: phone.lastFour,
    p_request_id: requestId,
  });
  if (error) throw mapSaveError(error, requestId);

  const row = (Array.isArray(data) ? data[0] : data) as { contact_id: string } | null;
  if (!row?.contact_id) throw mapSaveError(null, requestId);
  return { id: row.contact_id, lastFour: phone.lastFour };
}

export async function deleteCustomer(
  context: OrganizationContext,
  customerId: string,
  requestId: string,
): Promise<void> {
  const { data, error } = await context.db.rpc("rpc_customer_contact_delete", {
    p_org_id: context.orgId,
    p_contact_id: customerId,
    p_request_id: requestId,
  });
  if (error) throw mapSaveError(error, requestId);
  if (data !== true) throw new ApiError(404, ERROR_CODE.notFound, "That customer was not found.");
}

/**
 * The whole number for one saved customer, for the server's own use when it
 * sends a Text Request. Never returned to a browser.
 */
export async function customerPhone(
  context: OrganizationContext,
  customerId: string,
): Promise<string> {
  const stored = await readStoredCustomer(context, customerId);
  const phone = decrypt(stored.phoneEncrypted);
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
 * Free text an owner typed (a name) could start a spreadsheet formula, so a
 * leading = + - @ is neutralised. A stored number is E.164, digits after a
 * plus, and is left exactly as it is.
 */
function csvText(value: string): string {
  return csvField(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
}

/**
 * The business's own list as CSV: name, number, texting permission, added.
 * Recorded in the audit log with a count before it is returned.
 */
export async function exportCustomers(
  context: OrganizationContext,
  requestId: string,
): Promise<{ csv: string; count: number }> {
  const rows = await readRows(context);

  const lines = [["Name", "Mobile number", "Texting permission", "Added"].map(csvField).join(",")];
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
        csvField(customerConsentState(row.consent_status).label),
        csvField(row.created_at.slice(0, 10)),
      ].join(","),
    );
  }

  const { error } = await context.db.rpc("rpc_customer_contacts_record_export", {
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
