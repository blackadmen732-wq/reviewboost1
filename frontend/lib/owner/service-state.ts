import { customerMessages } from "@/lib/i18n/customer-messages";
import { PLAN_CATALOG } from "@/lib/owner/plan-catalog";

/**
 * Whether this business's Tags open for customers, in the owner's words.
 *
 * Setting up and serving customers are separate questions (migration
 * 20260915001400): a business that has never chosen a plan can name itself,
 * print its code and preview its page, but every scan of that code shows the
 * customer "This review link isn't active." Home used to say "Your tag is
 * ready. Put it where people pay." to exactly that business, which then found
 * out from its own test scan, or from a customer.
 *
 * `status` is the effective one (an ended trial already reads as suspended).
 * "unknown" is a failed or missing read: nothing is said rather than a guess.
 */
export type ServiceKind = "serving" | "trial" | "past-due" | "no-plan" | "cancelled" | "suspended" | "unknown";

export function serviceKind(status: string | null | undefined, planId: string | null | undefined): ServiceKind {
  switch (status) {
    case "trialing":
      return "trial";
    case "active":
      return "serving";
    case "past_due":
      return "past-due";
    case "cancelled":
      return "cancelled";
    case "suspended":
      return planId ? "suspended" : "no-plan";
    default:
      return "unknown";
  }
}

/** Whether a customer who scans a Tag right now gets the rating page. */
export function tagsServeCustomers(kind: ServiceKind): boolean {
  return kind === "serving" || kind === "trial" || kind === "past-due" || kind === "unknown";
}

export interface ServiceNotice {
  /** `plan`: Tags are closed. `payment`: open, with a failed card to fix. */
  kind: "plan" | "payment";
  title: string;
  body: string;
  action: { label: "Choose a plan" | "Update payment" | "Open Billing"; href: "/settings/billing" };
}

/** What a closed Tag shows a customer, quoted so the owner recognises it. */
const CLOSED = `“${customerMessages.en.unavailableHeading.replace(/\.$/, "")}”`;

const TRIAL_DAYS = PLAN_CATALOG.starter.trialDays;

/** The one thing to say about billing, or null when there is nothing to say. */
export function serviceNotice(kind: ServiceKind): ServiceNotice | null {
  switch (kind) {
    case "no-plan":
      return {
        kind: "plan",
        title: "Your Tag is off until you choose a plan",
        body: `Until then, anyone who scans it sees ${CLOSED}. ${PLAN_CATALOG.starter.name} is free for ${TRIAL_DAYS} days.`,
        action: { label: "Choose a plan", href: "/settings/billing" },
      };
    case "cancelled":
      return {
        kind: "plan",
        title: "Your plan is cancelled",
        body: `Customers who scan a Tag see ${CLOSED}. Your Tags and ratings are all still here.`,
        action: { label: "Choose a plan", href: "/settings/billing" },
      };
    case "suspended":
      return {
        kind: "plan",
        title: "Your Tags are switched off",
        body: `Your plan isn’t active, so customers who scan a Tag see ${CLOSED}. Nothing has been deleted.`,
        action: { label: "Open Billing", href: "/settings/billing" },
      };
    case "past-due":
      return {
        kind: "payment",
        title: "Your last payment didn’t go through",
        body: "Your Tags still work. Update your card to keep it that way.",
        action: { label: "Update payment", href: "/settings/billing" },
      };
    default:
      return null;
  }
}
