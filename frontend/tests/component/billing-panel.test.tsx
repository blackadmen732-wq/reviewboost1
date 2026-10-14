import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({ auth: { getSession: vi.fn() } }),
}));

import { BillingPanel } from "@/features/dashboard/billing-panel";

/**
 * What the billing screen offers, by plan and by role.
 *
 * Starter is the only plan with a trial, and only for a business that has
 * never subscribed. Growth and Pro say they charge now. Only the owner gets a
 * button, because `api/v1/billing` POST refuses everyone else.
 */

const NEVER_SUBSCRIBED = {
  planId: null,
  status: "suspended" as const,
  cancelAtPeriodEnd: false,
  trialEndsAt: null,
  currentPeriodEnd: null,
  smsBalance: { monthly: 0, purchased: 0, total: 0 },
};

describe("BillingPanel", () => {
  it("offers a trial on Starter only, and a charge on Growth and Pro", () => {
    render(<BillingPanel billing={NEVER_SUBSCRIBED} canManage />);

    expect(screen.getByRole("button", { name: "Start 7-day trial" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Choose Growth" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Choose Pro" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: /trial/i })).toHaveLength(1);
    // What each button costs is said beside it, not left to Stripe.
    expect(screen.getByText("Card required. $49 a month after 7 days.")).toBeVisible();
    expect(screen.getByText("Charged $79 when you subscribe. No trial.")).toBeVisible();
    expect(screen.getByText("Charged $129 when you subscribe. No trial.")).toBeVisible();
  });

  it("offers no second trial after a cancellation", () => {
    render(
      <BillingPanel
        billing={{ ...NEVER_SUBSCRIBED, planId: "starter", status: "cancelled" }}
        canManage
      />,
    );

    expect(screen.queryByRole("button", { name: /trial/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose Starter" })).toBeVisible();
    expect(screen.getByText("Charged $49 when you subscribe. No trial.")).toBeVisible();
  });

  it("shows a non-owner the plan and no button the API would refuse", () => {
    render(
      <BillingPanel
        billing={{ ...NEVER_SUBSCRIBED, planId: "growth", status: "active" }}
        canManage={false}
      />,
    );

    expect(screen.getByText("Growth")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/only the owner can/i)).toBeVisible();
  });

  it("shows usage against the real limits while the plan is running", () => {
    render(
      <BillingPanel
        billing={{
          ...NEVER_SUBSCRIBED,
          planId: "starter",
          status: "active",
          currentPeriodEnd: "2026-10-24T00:00:00Z",
          smsBalance: { monthly: 74, purchased: 0, total: 74 },
          usage: { locations: { used: 1, limit: 1 }, tags: { used: 2, limit: 3 } },
        }}
        canManage
      />,
    );

    expect(screen.getByText("1 of 1 location")).toBeVisible();
    expect(screen.getByText("2 of 3 Tags")).toBeVisible();
    expect(screen.getByText("74 of 150")).toBeVisible();
    expect(screen.getByRole("button", { name: "Manage plan and payment" })).toBeVisible();
    // A running plan is not offered a checkout.
    expect(screen.queryByRole("button", { name: /Choose|trial/ })).not.toBeInTheDocument();
  });

  it("says a trial has no texts rather than showing an empty allowance", () => {
    render(
      <BillingPanel
        billing={{
          ...NEVER_SUBSCRIBED,
          planId: "starter",
          status: "trialing",
          trialEndsAt: "2026-10-01T00:00:00Z",
          usage: { locations: { used: 1, limit: 1 }, tags: { used: 0, limit: 1 } },
        }}
        canManage
      />,
    );

    expect(screen.getByText("None during the trial")).toBeVisible();
    expect(screen.getByText("0 of 1 Tag")).toBeVisible();
  });

  it("puts a failed payment in a banner, keeps the Tags honest, and offers the fix", () => {
    render(
      <BillingPanel
        billing={{
          ...NEVER_SUBSCRIBED,
          planId: "growth",
          status: "past_due",
          smsBalance: { monthly: 120, purchased: 0, total: 120 },
          // The database allows no new Tags while past due.
          usage: { locations: { used: 1, limit: 0 }, tags: { used: 5, limit: 0 } },
        }}
        canManage
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/still working/i);
    expect(screen.getByRole("button", { name: "Update payment method" })).toBeVisible();
    // Measured against the plan, not against the zero the database uses to
    // stop new Tags — "5 of 0" would be nonsense.
    expect(screen.getByText("5 of 8 Tags")).toBeVisible();
    expect(screen.getByText(/New Tags can be added once the payment goes through/)).toBeVisible();
  });
});
