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

    expect(screen.getByRole("button", { name: "Start 7-day free trial" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Subscribe for $79 a month" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Subscribe for $129 a month" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: /trial/i })).toHaveLength(1);
  });

  it("offers no second trial after a cancellation", () => {
    render(
      <BillingPanel
        billing={{ ...NEVER_SUBSCRIBED, planId: "starter", status: "cancelled" }}
        canManage
      />,
    );

    expect(screen.queryByRole("button", { name: /trial/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Subscribe for $49 a month" })).toBeVisible();
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
});
