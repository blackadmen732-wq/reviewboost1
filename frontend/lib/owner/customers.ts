/**
 * Customers and Text Request states, in the words an owner reads.
 *
 * Shared by the Customers list, the Text Requests composer and the export, so
 * a status cannot be "Sent" in one place and "Delivered" in another.
 */

export const CUSTOMER_NAME_MAX = 80;

export type CustomerConsentKind = "agreed" | "no_record" | "opted_out";

export interface CustomerConsentState {
  kind: CustomerConsentKind;
  label: string;
}

/**
 * What the consent ledger says about texting this customer.
 *
 * "No record" is the honest default: saving someone is not their agreement,
 * and an unknown status is not a yes.
 */
export function customerConsentState(status: string | null | undefined): CustomerConsentState {
  if (status === "opted_in") return { kind: "agreed", label: "Agreed to texts" };
  if (status === "opted_out") return { kind: "opted_out", label: "Asked not to be texted" };
  return { kind: "no_record", label: "No agreement recorded" };
}

export type RequestTone = "ok" | "wait" | "bad" | "off";

export const TEXT_REQUEST_STATUS: Record<string, { label: string; tone: RequestTone }> = {
  scheduled: { label: "Scheduled", tone: "wait" },
  queued: { label: "Queued", tone: "wait" },
  sending: { label: "Sending", tone: "wait" },
  // Accepted by the carrier. Not "Delivered" until a receipt says so.
  submitted: { label: "Sent", tone: "wait" },
  provider_unknown: { label: "Delivery unknown", tone: "wait" },
  delivered: { label: "Delivered", tone: "ok" },
  failed: { label: "Not delivered", tone: "bad" },
  suppressed: { label: "Not sent: opted out or blocked", tone: "off" },
  cancelled: { label: "Cancelled", tone: "off" },
};

export function textRequestStatus(status: string): { label: string; tone: RequestTone } {
  return TEXT_REQUEST_STATUS[status] ?? { label: status, tone: "wait" };
}

/** Sort for display: named customers by name, then the unnamed by last four. */
export function compareCustomers(
  a: { name: string | null; lastFour: string },
  b: { name: string | null; lastFour: string },
): number {
  if (a.name && b.name) return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  if (a.name) return -1;
  if (b.name) return 1;
  return a.lastFour.localeCompare(b.lastFour);
}

/** Case- and accent-insensitive match on the name or the last digits typed. */
export function matchesCustomer(
  customer: { name: string | null; lastFour: string },
  query: string,
): boolean {
  const q = query.trim();
  if (q === "") return true;
  const digits = q.replace(/\D/g, "");
  if (digits.length > 0 && digits.length <= 4 && customer.lastFour.endsWith(digits)) return true;
  if (!customer.name) return false;
  const fold = (value: string) =>
    value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase();
  return fold(customer.name).includes(fold(q));
}

/** How far back a visit puts someone at the top of the Text Request picker. */
export const RECENT_VISIT_DAYS = 14;

/**
 * Split customers for choosing whom to text: people who visited recently
 * (from a connected app's sales or appointments) first, most recent first,
 * then everyone else by name. Only an ordering: a recent visit is not
 * permission to text anyone, and nothing is sent until the owner sends it.
 */
export function groupForPicker<T extends { name: string | null; lastFour: string; lastVisitAt?: string | null }>(
  customers: readonly T[],
  now: number = Date.now(),
): { recent: T[]; others: T[] } {
  const since = now - RECENT_VISIT_DAYS * 86_400_000;
  const visitedAt = (customer: T) => {
    const at = customer.lastVisitAt ? Date.parse(customer.lastVisitAt) : NaN;
    return Number.isFinite(at) && at >= since && at <= now ? at : null;
  };
  const recent = customers
    .filter((customer) => visitedAt(customer) !== null)
    .sort((a, b) => (visitedAt(b) ?? 0) - (visitedAt(a) ?? 0) || compareCustomers(a, b));
  const others = customers.filter((customer) => visitedAt(customer) === null).sort(compareCustomers);
  return { recent, others };
}
