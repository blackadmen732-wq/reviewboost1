/**
 * Owner words for the fixed codes the server stores. The server never stores
 * provider-supplied text for these, so this is the only place they are worded.
 */

export function stateLabel(state: string, appName: string): { label: string; tone: "good" | "info" | "warn" | "bad" } {
  switch (state) {
    case "active":
      return { label: "On", tone: "good" };
    case "connecting":
      return { label: "Setting up", tone: "info" };
    case "authorization_required":
      return { label: "Needs permission", tone: "warn" };
    case "reauth_required":
      return { label: "Sign in again", tone: "warn" };
    case "unavailable":
      return { label: `Can't reach ${appName}`, tone: "warn" };
    case "error":
      return { label: "Needs attention", tone: "bad" };
    case "disconnecting":
      return { label: "Disconnecting", tone: "info" };
    default:
      return { label: "Off", tone: "info" };
  }
}

export function issueLabel(code: string): string {
  switch (code) {
    case "no_phone":
      return "No phone number";
    case "invalid_phone":
      return "Phone number can't be used";
    case "customer_not_reachable":
      return "Visit by a customer with no usable phone";
    case "location_not_mapped":
      return "Visit at a place you didn't choose";
    case "no_customer":
      return "Sale with no customer attached";
    default:
      return "Couldn't be brought in";
  }
}

export function runLabel(kind: string): string {
  switch (kind) {
    case "backfill":
      return "First read (last 30 days)";
    case "manual":
      return "Update now";
    case "reconcile":
      return "Regular update";
    default:
      return "Update";
  }
}

export function runStatusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "Waiting";
    case "running":
      return "Running";
    case "succeeded":
      return "Done";
    case "partial":
      return "Done, some skipped";
    case "failed":
      return "Didn't finish";
    case "cancelled":
      return "Stopped";
    default:
      return status;
  }
}

export function formatWhen(value: string | null): string {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not yet";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
