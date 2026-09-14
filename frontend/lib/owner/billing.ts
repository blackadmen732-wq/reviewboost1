import { TRIAL_DAYS, type PlanId } from "@/lib/owner/plan-catalog";

export type SubscriptionState =
  | "none"
  | "trialing"
  | "active"
  | "past_due"
  | "cancelled"
  | "suspended";

export interface BillingInfo {
  state: SubscriptionState;
  planId: PlanId | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export function billingStateLabel(state: SubscriptionState): string {
  switch (state) {
    case "none": return "No subscription";
    case "trialing": return "Free trial";
    case "active": return "Active";
    case "past_due": return "Payment failed";
    case "cancelled": return "Cancelled";
    case "suspended": return "Suspended";
  }
}

export function billingStateBadgeVariant(
  state: SubscriptionState,
): "success" | "warning" | "error" | "neutral" {
  switch (state) {
    case "active": return "success";
    case "trialing": return "success";
    case "past_due": return "warning";
    case "cancelled":
    case "suspended": return "error";
    case "none": return "neutral";
  }
}

export function trialDaysLeftLabel(daysLeft: number | null): string | null {
  if (daysLeft === null) return null;
  if (daysLeft <= 0) return "Trial ended";
  if (daysLeft === 1) return "1 day left in trial";
  return `${daysLeft} days left in trial`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export { TRIAL_DAYS };
