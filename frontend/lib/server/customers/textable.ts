import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { tryDecrypt } from "@/lib/server/crypto";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";

/**
 * The bridge from Connections to Text Requests.
 *
 * People brought in from a Google Sheet, a spreadsheet file or a connected app
 * become customers. This module lists them for the Text Requests picker, each
 * with a plain-words texting status, and turns a picked customer back into the
 * phone number the existing send path needs, on the server only.
 *
 * Nothing here records consent or sends anything. The status comes from the
 * same gate the send path uses (`app.sms_can_send`, through
 * `rpc_sms_can_send_many`), and the send path checks the chosen number again.
 */

export const MAX_PICKER_CUSTOMERS = 2000;

export type TextableStatus = "can_text" | "no_consent" | "opted_out" | "on_hold";

export interface TextableCustomer {
  customerId: string;
  /** Null when no source gave a name; the picker shows the last four instead. */
  name: string | null;
  lastFour: string | null;
  /** Where they came from, in owner words, e.g. "Google Sheets". */
  sources: string[];
  status: TextableStatus;
  /** One short sentence for the picker row. */
  statusText: string;
}

const SOURCE_LABEL: Record<string, string> = {
  google_sheets: "Google Sheets",
  csv: "Spreadsheet",
  integration: "Connected app",
  manual: "Added by hand",
};

const STATUS_TEXT: Record<TextableStatus, string> = {
  can_text: "Can text",
  no_consent: "Hasn't agreed to texts yet",
  opted_out: "Asked not to get texts",
  on_hold: "Can't be texted right now",
};

/** Gate reason code to the picker's four states. */
export function statusFromGate(allowed: boolean, reason: string | null): TextableStatus {
  if (allowed) return "can_text";
  if (reason === "no_consent") return "no_consent";
  if (reason === "opt_out" || reason === "stop_keyword") return "opted_out";
  return "on_hold";
}

interface CustomerRow {
  id: string;
  phone_hash: string;
  phone_last_four: string | null;
  display_name_encrypted: string | null;
}

/**
 * Customers for the picker, newest first, read through the caller's RLS
 * (owners and admins only), with their texting status.
 */
export async function listTextableCustomers(
  db: SupabaseClient,
  orgId: string,
  requestId: string,
): Promise<TextableCustomer[]> {
  const { data, error } = await db
    .from("customers")
    .select("id, phone_hash, phone_last_four, display_name_encrypted")
    .eq("org_id", orgId)
    .order("last_seen_at", { ascending: false })
    .limit(MAX_PICKER_CUSTOMERS);
  if (error) {
    logger.error("customers.textable_list_failed", { requestId, code: error.code });
    throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Your customers couldn't be loaded.");
  }
  const rows = (data ?? []) as CustomerRow[];
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const profiles = await db
    .from("customer_source_profiles")
    .select("customer_id, source_kind")
    .eq("org_id", orgId)
    .eq("status", "active")
    .in("customer_id", ids);
  if (profiles.error) {
    logger.error("customers.textable_sources_failed", { requestId, code: profiles.error.code });
    throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Your customers couldn't be loaded.");
  }
  const sourcesById = new Map<string, Set<string>>();
  for (const profile of (profiles.data ?? []) as Array<{ customer_id: string; source_kind: string }>) {
    const label = SOURCE_LABEL[profile.source_kind] ?? "Imported";
    const set = sourcesById.get(profile.customer_id) ?? new Set<string>();
    set.add(label);
    sourcesById.set(profile.customer_id, set);
  }

  const gate = await serviceRoleClient().rpc("rpc_sms_can_send_many", {
    p_org_id: orgId,
    p_phone_hashes: rows.map((row) => row.phone_hash),
    p_purpose: "review_request",
  });
  if (gate.error) {
    // Fail closed: without the gate's answer nobody is shown as textable.
    logger.error("customers.textable_gate_failed", { requestId, code: gate.error.code });
    throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Your customers couldn't be loaded.");
  }
  const statusByHash = new Map<string, TextableStatus>();
  for (const row of (gate.data ?? []) as Array<{ phone_hash: string; allowed: boolean; reason: string | null }>) {
    statusByHash.set(row.phone_hash, statusFromGate(row.allowed, row.reason));
  }

  return rows.map((row) => {
    const status = statusByHash.get(row.phone_hash) ?? "on_hold";
    return {
      customerId: row.id,
      name: tryDecrypt(row.display_name_encrypted),
      lastFour: row.phone_last_four,
      sources: [...(sourcesById.get(row.id) ?? [])].sort(),
      status,
      statusText: STATUS_TEXT[status],
    };
  });
}

/**
 * The phone number of one customer, for the send path. Read through the
 * caller's RLS, so a customer of another business is simply not found.
 */
export async function resolveCustomerPhone(
  db: SupabaseClient,
  orgId: string,
  customerId: string,
  requestId: string,
): Promise<string> {
  const { data, error } = await db
    .from("customers")
    .select("phone_encrypted")
    .eq("org_id", orgId)
    .eq("id", customerId)
    .maybeSingle();
  if (error) {
    logger.error("customers.resolve_phone_failed", { requestId, code: error.code });
    throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
  }
  if (!data) throw new ApiError(404, ERROR_CODE.notFound, "That customer was not found.");
  const phone = tryDecrypt((data as { phone_encrypted: string | null }).phone_encrypted);
  if (!phone) {
    throw new ApiError(409, ERROR_CODE.notEligible, "We don't have a phone number saved for this customer.");
  }
  return phone;
}
