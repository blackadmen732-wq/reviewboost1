import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CustomerBlockingState } from "@/features/customer-flow/customer-blocking-state";
import { customerMessages } from "@/lib/i18n/customer-messages";

/**
 * "This review link isn't active" and the could-not-load screens are part of
 * the same customer page. They used their own frame, with a green-logo footer
 * and a different language button, so a customer met what looked like a
 * second product. They now sit in the rating screen's panel.
 */
describe("customer page when it cannot rate", () => {
  it("shows a closed link in the rating screen's panel, footer and language pill", () => {
    render(
      <CustomerBlockingState
        kind="unavailable"
        locale="en"
        messages={customerMessages.en}
        onLocaleChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: customerMessages.en.unavailableHeading })).toBeVisible();
    expect(document.querySelector("[data-customer-visit] [data-flow-screen='blocking']")).not.toBeNull();
    // The grey bolt footer and the approved promise line, as on the rating screen.
    expect(document.querySelector("[data-powered-by] [data-powered-bolt]")).not.toBeNull();
    expect(screen.getByText(customerMessages.en.footerPromise)).toBeVisible();
    expect(document.querySelector(".visit-language select")).not.toBeNull();
    // A closed link has nothing to try again.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps Try again for a page that failed to load", () => {
    render(
      <CustomerBlockingState
        kind="error"
        locale="en"
        messages={customerMessages.en}
        onLocaleChange={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(document.querySelector("[data-customer-visit] [data-flow-screen='blocking']")).not.toBeNull();
    expect(screen.getByRole("button", { name: customerMessages.en.tryAgain })).toBeEnabled();
  });
});
