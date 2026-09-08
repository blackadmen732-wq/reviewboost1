import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { describe, expect, it, vi } from "vitest";

import { CustomerPage } from "@/features/customer-page/customer-page";
import { CustomerPageFallback } from "@/features/customer-page/customer-page-fallback";
import type { CustomerPageStatus } from "@/features/customer-page/customer-page-status";
import type { CustomerPagePresentation } from "@/lib/customer-page/design";
import { customerMessages } from "@/lib/i18n/customer-messages";

/**
 * The customer page has to work for someone who cannot see the photograph, is
 * using a screen reader on a bus, or is holding the phone one-handed with the
 * text size turned up. None of that is optional, and none of it is visible in a
 * screenshot, so every state gets checked here rather than only the happy one.
 */

const messages = customerMessages.en;

const presentation: CustomerPagePresentation = {
  businessName: "Mario’s Pizza",
  locationName: "Downtown",
  design: {
    heroImage: "/fixtures/customer-page-hero.jpg",
    heroFocalX: 50,
    heroFocalY: 74,
    heroZoom: 1.06,
    logo: null,
    look: "signature",
    tagline: "Good pizza. Brighter days.",
  },
  languages: ["en", "es", "ht"],
  defaultLanguage: "en",
};

function renderPage(status: CustomerPageStatus, rating: 1 | 2 | 3 | 4 | 5 | null) {
  return render(
    <CustomerPage
      presentation={presentation}
      messages={messages}
      locale="en"
      rating={rating}
      status={status}
      onSelect={vi.fn()}
      onCommit={vi.fn()}
      onRetry={vi.fn()}
      onLocaleChange={vi.fn()}
    />,
  );
}

describe("customer page accessibility", () => {
  it.each([
    ["waiting for a tap", "idle" as const, null],
    ["saving a rating", "saving" as const, 4 as const],
    ["handing off to Google", "opening" as const, 4 as const],
    ["a failed save", "failed" as const, 2 as const],
    ["an offline save", "offline" as const, 5 as const],
  ])("has no Axe violations while %s", async (_name, status, rating) => {
    const { container } = renderPage(status, rating);
    expect((await axe(container)).violations).toEqual([]);
  });

  it.each([
    ["an unavailable tag", "unavailable" as const],
    ["a page that could not load", "error" as const],
  ])("has no Axe violations on %s", async (_name, kind) => {
    const { container } = render(
      <CustomerPageFallback
        kind={kind}
        messages={messages}
        locale="en"
        onLocaleChange={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe("customer page semantics", () => {
  it("offers the stars as one named group of radios", () => {
    renderPage("idle", null);

    const group = screen.getByRole("radiogroup", { name: messages.ratingGroup });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(5);

    for (const rating of [1, 2, 3, 4, 5] as const) {
      expect(
        screen.getByRole("radio", { name: messages.ratingSpoken[rating] }),
      ).toBeInTheDocument();
    }
  });

  it("speaks a rating as a count of stars, not as a verdict", () => {
    renderPage("idle", null);

    for (const rating of [1, 2, 3, 4, 5] as const) {
      const label = messages.ratingSpoken[rating];
      // "1 star" and "5 stars" — no "poor", no "excellent". The customer is not
      // told what their own rating means, and nothing implies a threshold.
      expect(label).toMatch(/^\d star/);
      expect(label).not.toMatch(/poor|bad|good|great|excellent|terrible/i);
    }
  });

  it("announces a save failure without moving focus or hiding the stars", () => {
    renderPage("failed", 2);

    expect(screen.getByRole("alert")).toHaveTextContent(messages.saveFailedHeading);
    expect(screen.getByRole("radio", { name: messages.ratingSpoken[2] })).toBeChecked();
    expect(screen.getByRole("button", { name: messages.tryAgain })).toBeEnabled();
  });

  it("keeps the handoff message in a live region rather than a new screen", () => {
    renderPage("opening", 4);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(messages.opening);
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
  });

  it("hides the photograph from assistive technology and keeps the name as text", () => {
    const { container } = renderPage("idle", null);

    expect(container.querySelector(".cp-hero__photo")).toHaveAttribute("alt", "");
    // The wordmark is real text, so the business name is announced and — the
    // reason it is not baked into an image — is always spelled correctly.
    expect(container.querySelector(".cp-hero__identity")).toHaveTextContent(
      "Mario’s",
    );
  });

  it("does not let the preview offer a control that writes", () => {
    render(
      <CustomerPage
        presentation={presentation}
        messages={messages}
        locale="en"
        rating={3}
        status="idle"
        onSelect={vi.fn()}
        mode="preview"
      />,
    );

    expect(screen.queryByRole("main")).not.toBeInTheDocument();
    expect(screen.getByText(messages.previewLabel)).toBeVisible();
  });
});
