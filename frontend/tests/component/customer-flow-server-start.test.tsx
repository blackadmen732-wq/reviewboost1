import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerFlow } from "@/features/customer-flow/customer-flow";
import { navigateToDestination } from "@/features/customer-flow/destination-handoff";
import { EARLY_TAP_MARKER_PREFIX } from "@/features/customer-flow/early-tap";
import type { CustomerReviewContext } from "@/lib/api/customer-flow-types";
import { customerMessages } from "@/lib/i18n/customer-messages";
import { renderWithProviders } from "@/tests/helpers/render";

vi.mock("@/features/customer-flow/destination-handoff", () => ({
  navigateToDestination: vi.fn(),
}));

/**
 * The customer page as the server now sends it: data already in hand, the
 * stars inside a form a tap can submit before React is ready, and React taking
 * over without asking the API again.
 */

const DESTINATION = "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4";

function context(overrides: Partial<CustomerReviewContext> = {}): CustomerReviewContext {
  return {
    business: { name: "Mario’s Pizza", logoUrl: null },
    location: { name: "Downtown" },
    page: { templateId: "classic", tagline: null, logoUrl: null, heroUrl: null },
    destination: { provider: "google", url: DESTINATION },
    googleReviewUrl: DESTINATION,
    supportedLocales: ["en", "es", "ht"],
    defaultLocale: "en",
    ...overrides,
  } as CustomerReviewContext;
}

const FORM = { action: "/q/fixture-valid/rate", key: "0123456789abcdef0123456789abcdef" };

beforeAll(() => {
  process.env.NEXT_PUBLIC_USE_CUSTOMER_FIXTURES = "true";
});

beforeEach(() => {
  window.__RB_FIXTURE_CALLS__ = [];
  vi.mocked(navigateToDestination).mockClear();
});

afterEach(() => {
  delete window.__rbFlowReady;
  delete window.__rbEarly;
  window.sessionStorage.clear();
});

describe("a customer page that arrives complete", () => {
  it("shows the business and the stars at once, without asking the API", () => {
    renderWithProviders(<CustomerFlow token="fixture-valid" initialContext={context()} earlyForm={FORM} />);

    // Synchronously: no loading screen, no fetch.
    expect(screen.getByRole("heading", { name: customerMessages.en.ratingHeading })).toBeInTheDocument();
    expect(document.querySelector("[data-business-name]")).toHaveTextContent("Mario’s Pizza");
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(window.__RB_FIXTURE_CALLS__?.filter((call) => call.operation === "context")).toEqual([]);
  });

  it("puts the stars in a form the early-tap script can submit, with one key per page view", () => {
    renderWithProviders(<CustomerFlow token="fixture-valid" initialContext={context()} earlyForm={FORM} />);

    const form = document.querySelector<HTMLFormElement>("form[data-early-submit]");
    expect(form).not.toBeNull();
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.getAttribute("action")).toBe(FORM.action);
    expect(form?.querySelector<HTMLInputElement>("input[name=key]")?.value).toBe(FORM.key);
    expect(form?.querySelector<HTMLInputElement>("input[name=locale]")?.value).toBe("en");
    expect(form?.querySelectorAll("input[name=visit-rating]")).toHaveLength(5);
  });

  it("hands the stars to React once it is ready, and never submits the form itself", async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
    const user = userEvent.setup();
    renderWithProviders(<CustomerFlow token="fixture-valid" initialContext={context()} earlyForm={FORM} />);
    await waitFor(() => expect(window.__rbFlowReady).toBe(true));

    await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[2] }));
    await screen.findByRole("heading", { name: customerMessages.en.thanksHeading });
    await waitFor(() => expect(navigateToDestination).toHaveBeenCalledWith(DESTINATION));
    expect(submit).not.toHaveBeenCalled();
    submit.mockRestore();
  });

  it("opens in the business's own language", () => {
    renderWithProviders(
      <CustomerFlow token="fixture-valid" initialContext={context({ defaultLocale: "es" })} earlyForm={FORM} />,
    );
    expect(screen.getByRole("heading", { name: customerMessages.es.ratingHeading })).toBeInTheDocument();
  });

  it("shows the neutral not-active screen when the server already knows", () => {
    renderWithProviders(<CustomerFlow token="fixture-valid" initialUnavailable />);
    expect(screen.getByRole("heading", { name: customerMessages.en.unavailableHeading })).toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("keeps the chosen star with a Try again after an early submit failed", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CustomerFlow token="fixture-valid" initialContext={context()} earlyForm={FORM} failedRating={4} />,
    );
    expect(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[4] })).toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent(customerMessages.en.submitErrorHeading);

    await user.click(screen.getByRole("button", { name: customerMessages.en.tryAgain }));
    await waitFor(() => expect(navigateToDestination).toHaveBeenCalledWith(DESTINATION));
  });

  it("shows the handoff, never a second rating form, after the back button", async () => {
    window.sessionStorage.setItem(`${EARLY_TAP_MARKER_PREFIX}${window.location.pathname}`, String(Date.now()));
    renderWithProviders(<CustomerFlow token="fixture-valid" initialContext={context()} earlyForm={FORM} />);
    await screen.findByRole("heading", { name: customerMessages.en.thanksHeading });
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("ignores a React tap once the early form is already on its way", async () => {
    window.__rbEarly = 3;
    const user = userEvent.setup();
    renderWithProviders(<CustomerFlow token="fixture-valid" initialContext={context()} earlyForm={FORM} />);
    await screen.findByRole("heading", { name: customerMessages.en.thanksHeading });
    expect(window.__RB_FIXTURE_CALLS__?.filter((call) => call.operation === "response")).toEqual([]);
    expect(user).toBeDefined();
  });
});
