import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerFlow } from "@/features/customer-flow/customer-flow";
import { navigateToDestination } from "@/features/customer-flow/destination-handoff";
import { customerMessages, type RatingValue } from "@/lib/i18n/customer-messages";
import { renderWithProviders } from "@/tests/helpers/render";

vi.mock("@/features/customer-flow/destination-handoff", () => ({
  navigateToDestination: vi.fn(),
}));

const navigate = vi.mocked(navigateToDestination);

const FIXTURE_DESTINATION =
  "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4";

beforeAll(() => {
  process.env.NEXT_PUBLIC_USE_CUSTOMER_FIXTURES = "true";
});

beforeEach(() => {
  navigate.mockClear();
  window.__RB_FIXTURE_CALLS__ = [];
});

async function openRating(token = "fixture-valid") {
  const user = userEvent.setup();
  renderWithProviders(<CustomerFlow token={token} />);
  // fixture-slow takes 1.35s to load the page as well as to answer.
  await screen.findByRole("heading", { name: customerMessages.en.ratingHeading }, { timeout: 4000 });
  return user;
}

async function tapStar(
  user: ReturnType<typeof userEvent.setup>,
  rating: RatingValue,
) {
  await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[rating] }));
  await screen.findByRole("heading", { name: customerMessages.en.thanksHeading }, { timeout: 5000 });
  return document.querySelector<HTMLElement>("[data-flow-screen='handoff']");
}

function ratingCalls() {
  return window.__RB_FIXTURE_CALLS__?.filter(({ operation }) => operation === "rating") ?? [];
}

function storedDraft(token = "fixture-valid") {
  const raw = window.sessionStorage.getItem(`reviewboost:customer-flow:${token}`);
  return raw ? (JSON.parse(raw) as { screen: string; pending: { key: string } | null }) : null;
}

describe("one-tap customer flow", () => {
  it("sends every rating 1–5 to a byte-identical handoff and the same destination", async () => {
    const handoffMarkup: string[] = [];

    for (const rating of [1, 2, 3, 4, 5] as const) {
      const user = await openRating();
      await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[rating] }));
      // On the tap itself: no wait for the save, no screen first.
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith(FIXTURE_DESTINATION);

      await screen.findByRole("heading", { name: customerMessages.en.thanksHeading }, { timeout: 5000 });
      const handoff = document.querySelector<HTMLElement>("[data-flow-screen='handoff']");
      expect(handoff).not.toBeNull();
      handoffMarkup.push(handoff?.outerHTML ?? "");
      expect(screen.queryByText(customerMessages.en.ratingLabels[rating])).not.toBeInTheDocument();

      cleanup();
      navigate.mockClear();
      window.sessionStorage.clear();
    }

    expect(new Set(handoffMarkup).size).toBe(1);
  });

  it("opens the destination before the save is answered, with the save already on its way", async () => {
    let requestsWhenLeaving = -1;
    navigate.mockImplementation(() => {
      requestsWhenLeaving = ratingCalls().length;
    });
    // fixture-slow takes 1.35s to answer: a page that waited for the save
    // would not have navigated yet.
    const user = await openRating("fixture-slow");
    await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[2] }));

    expect(navigate).toHaveBeenCalledWith(FIXTURE_DESTINATION);
    expect(requestsWhenLeaving).toBe(1);
    // And the back button already has the handoff to come back to.
    expect(storedDraft("fixture-slow")).toMatchObject({ screen: "handoff" });
    navigate.mockImplementation(() => undefined);
  });

  it("asks for nothing between the star and the destination", async () => {
    const user = await openRating();
    await tapStar(user, 2);

    // No confirm step, no note, no Team Praise, no way to decline the
    // destination, and nothing to press: the only control on the handoff is
    // a quiet fallback link, there for a browser that did not follow.
    const buttons = screen.queryAllByRole("button").map((button) => button.textContent);
    expect(buttons).toEqual([]);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/without|skip|no thanks/i);

    const link = document.querySelector<HTMLAnchorElement>("[data-destination-link]");
    expect(link?.getAttribute("href")).toBe(FIXTURE_DESTINATION);
  });

  it("sends one request for one tap: the rating, its language and a key", async () => {
    const user = await openRating();
    await tapStar(user, 3);

    const calls = ratingCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ body: { rating: 3, locale: "en" } });
    expect(calls[0]?.idempotencyKey).toMatch(/^rb_rating_/);
    expect(window.__RB_FIXTURE_CALLS__?.map(({ operation }) => operation)).not.toContain("session");
  });

  it("does not send or navigate twice when the stars are tapped again while it leaves", async () => {
    const user = await openRating();
    const four = screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[4] });
    await user.dblClick(four);
    const five = screen.queryByRole("radio", { name: customerMessages.en.ratingSpoken[5] });
    if (five) await user.click(five).catch(() => undefined);
    await screen.findByRole("heading", { name: customerMessages.en.thanksHeading }, { timeout: 5000 });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(ratingCalls()).toHaveLength(1);
  });

  it("finishes a save that failed when the customer comes back, under the same key", async () => {
    // The fixture refuses the first request with a 503, then accepts.
    const user = await openRating("fixture-response-error");
    await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[2] }));
    expect(navigate).toHaveBeenCalledTimes(1);

    await screen.findByRole("heading", { name: customerMessages.en.thanksHeading }, { timeout: 5000 });
    await waitFor(() => expect(ratingCalls()).toHaveLength(1));
    // Not confirmed: kept for a re-send.
    await waitFor(() => expect(storedDraft("fixture-response-error")?.pending).not.toBeNull());

    // Back from Google through the back-forward cache.
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });

    await waitFor(() => expect(storedDraft("fixture-response-error")?.pending).toBeNull());
    const keys = ratingCalls().map(({ idempotencyKey }) => idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("re-sends an unconfirmed save after a reload, and never navigates again", async () => {
    const user = await openRating("fixture-response-error");
    await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[5] }));
    await waitFor(() => expect(ratingCalls()).toHaveLength(1));
    await waitFor(() => expect(storedDraft("fixture-response-error")?.pending).not.toBeNull());
    const firstKey = ratingCalls()[0]?.idempotencyKey;

    cleanup();
    navigate.mockClear();
    renderWithProviders(<CustomerFlow token="fixture-response-error" />);

    await screen.findByRole("heading", { name: customerMessages.en.thanksHeading }, { timeout: 5000 });
    await waitFor(() => expect(storedDraft("fixture-response-error")?.pending).toBeNull());
    expect(ratingCalls().map(({ idempotencyKey }) => idempotencyKey)).toEqual([firstKey, firstKey]);
    expect(navigate).not.toHaveBeenCalled();
    // No stars to rate twice.
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("holds the rating offline, then sends it and opens Google when connectivity returns", async () => {
    const user = await openRating();
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[1] }));

    expect(await screen.findByText(customerMessages.en.offline)).toBeVisible();
    expect(navigate).not.toHaveBeenCalled();
    expect(ratingCalls()).toHaveLength(0);

    await act(async () => {
      Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
      window.dispatchEvent(new Event("online"));
    });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(FIXTURE_DESTINATION);
    expect(ratingCalls()).toHaveLength(1);
    await screen.findByRole("heading", { name: customerMessages.en.thanksHeading }, { timeout: 5000 });
  });

  it("shows indistinguishable UI for unknown and inactive links", async () => {
    renderWithProviders(<CustomerFlow token="fixture-unknown" />);
    await screen.findByRole("heading", { name: customerMessages.en.unavailableHeading });
    const unknownMarkup = document.querySelector(".customer-card")?.innerHTML;
    cleanup();

    renderWithProviders(<CustomerFlow token="fixture-inactive" />);
    await screen.findByRole("heading", { name: customerMessages.en.unavailableHeading });
    const inactiveMarkup = document.querySelector(".customer-card")?.innerHTML;
    expect(inactiveMarkup).toBe(unknownMarkup);
  });

  it("contains no customer contact, signup, or marketing fields", async () => {
    await openRating();
    expect(screen.queryByLabelText(/phone|email/i)).not.toBeInTheDocument();
    expect(document.querySelector("input[type='email'], input[type='tel']")).toBeNull();
    expect(document.body).not.toHaveTextContent(/newsletter|create an account|download the app/i);
  });

  it("moves focus to each new screen heading", async () => {
    const user = await openRating();
    const ratingHeading = screen.getByRole("heading", { name: customerMessages.en.ratingHeading });
    await waitFor(() => expect(ratingHeading).toHaveFocus());

    await tapStar(user, 3);
    const handoffHeading = await screen.findByRole("heading", {
      name: customerMessages.en.thanksHeading,
    });
    await waitFor(() => expect(handoffHeading).toHaveFocus());
  });
});
