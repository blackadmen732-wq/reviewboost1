import type { BillingState } from "./use-billing";

/**
 * What an account screen says, decided as a pure function.
 *
 * It lives apart from the screen so it can be tested without rendering, and
 * because the rule it encodes is a product rule rather than a layout one:
 * until the backend answers, there is no plan, no trial, and no balance to
 * show. A mobile screen that fills those in tells an owner they are subscribed
 * when they may not be — and on a phone it is often the only surface they
 * check.
 */
export type AccountView =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      planName: string;
      statusTitle: string;
      statusBody: string;
      needsAttention: boolean;
      /** True while the business's Tags are still serving customers. */
      serving: boolean;
    };

export function planLabel(planId: BillingState["planId"]): string {
  switch (planId) {
    case "starter":
      return "Starter";
    case "growth":
      return "Growth";
    case "pro":
      return "Pro";
    default:
      return "No plan";
  }
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  // "Nov 22, 2026", as the website writes it, whatever the phone's region.
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function accountView(
  billing: BillingState | null,
  error: string | null,
): AccountView {
  if (error) return { kind: "error", message: error };
  if (!billing) return { kind: "loading" };

  const planName = planLabel(billing.planId);
  const periodEnd = formatDate(billing.currentPeriodEnd);
  const trialEnd = formatDate(billing.trialEndsAt);

  switch (billing.status) {
    case "trialing":
      return {
        kind: "ready",
        planName,
        statusTitle: "Free trial",
        statusBody: trialEnd
          ? `Ends ${trialEnd}.`
          : "Your card is on file and your plan starts when the trial ends.",
        needsAttention: false,
        serving: true,
      };
    case "active":
      return {
        kind: "ready",
        planName,
        statusTitle: billing.cancelAtPeriodEnd ? "Ending soon" : "Active",
        statusBody: billing.cancelAtPeriodEnd
          ? periodEnd
            ? `Everything keeps working until ${periodEnd}.`
            : "Everything keeps working until the end of this period."
          : periodEnd
            ? `Next payment ${periodEnd}.`
            : "Your plan is running.",
        needsAttention: false,
        serving: true,
      };
    case "past_due":
      // Still serving. A failed card does not close the door, and telling an
      // owner their Tags are dead would send them to replace hardware that is
      // fine.
      //
      // States the fact and stops. This app is a free companion to a plan
      // bought on the web, and App Store 3.1.3(f) holds only while the app
      // neither sells nor points at where to pay — "update your card on the
      // web" was that pointer.
      return {
        kind: "ready",
        planName,
        statusTitle: "Payment failed",
        statusBody: "Your Tags are still working.",
        needsAttention: true,
        serving: true,
      };
    case "cancelled":
      return {
        kind: "ready",
        planName,
        statusTitle: "Cancelled",
        // No "when you subscribe": the same 3.1.3(f) line as past_due.
        statusBody: "Your Tags are not serving customers. Nothing has been deleted.",
        needsAttention: true,
        serving: false,
      };
    case "suspended":
      // The server answers "suspended" with no plan for a business that never
      // had one (frontend/lib/server/billing-service.ts readBillingState).
      // That is not a suspension: nothing was ever running. Said as a fact,
      // with no pointer to where a plan is chosen (3.1.3(f)), and said once:
      // "No plan" beside "No plan yet" in red read as two problems.
      if (billing.planId === null) {
        return {
          kind: "ready",
          planName: "No plan yet",
          statusTitle: "",
          statusBody: "Your Tags are off until this business has a plan.",
          needsAttention: true,
          serving: false,
        };
      }
      return {
        kind: "ready",
        planName,
        statusTitle: "Suspended",
        statusBody: "Your Tags are not serving customers. Nothing has been deleted.",
        needsAttention: true,
        serving: false,
      };
  }
}

/** What the business may have right now, as the server counts it. */
export interface IncludedView {
  /** "Includes" for a plan, "During your trial" for a trial. */
  label: string;
  locations: number;
  tags: number;
  texts: number;
}

/**
 * The trial's own allowance, not Starter's: one place, one Tag, no texts.
 * A copy of TRIAL_LIMITS in frontend/lib/server/entitlements.ts, which the
 * billing endpoint applies but does not send; `billing-view.test.ts` pins it
 * to the website's "During your trial · 1 of 1 Tag".
 */
export const TRIAL_INCLUDES = { locations: 1, tags: 1, texts: 0 } as const;

/**
 * The limits the server enforces (entitlements.ts `limitsFor`), never the
 * catalog's for a plan that is not running: a trial is the trial's
 * allowance, a running plan (paid up or retrying a card) is its plan, and a
 * business with no running plan has nothing to list.
 */
export function includedView(billing: BillingState | null): IncludedView | null {
  if (!billing) return null;
  if (billing.status === "trialing") {
    return { label: "During your trial", ...TRIAL_INCLUDES };
  }
  if ((billing.status === "active" || billing.status === "past_due") && billing.planId) {
    const plan = billing.plans[billing.planId];
    return { label: "Includes", locations: plan.locations, tags: plan.tags, texts: plan.monthlySmsSegments };
  }
  return null;
}

export type BalanceView =
  | { kind: "loading" }
  | { kind: "ready"; total: number; monthly: number; purchased: number; canSend: boolean };

/**
 * The Text Requests balance.
 *
 * Zero is a real state — a trial includes no messages — so it must never be
 * shown before it is known. `loading` and "you have none" are different
 * answers and the screen has to be able to tell them apart.
 */
export function balanceView(
  balance: { monthly: number; purchased: number; total: number } | null,
): BalanceView {
  if (!balance) return { kind: "loading" };
  return {
    kind: "ready",
    total: balance.total,
    monthly: balance.monthly,
    purchased: balance.purchased,
    canSend: balance.total > 0,
  };
}
