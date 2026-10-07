import { cleanup, screen, waitFor } from "@testing-library/react";
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
  await screen.findByRole("heading", { name: customerMessages.en.ratingHeading });
  return user;
}

async function tapStar(
  user: ReturnType<typeof userEvent.setup>,
  rating: RatingValue,
) {
  await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[rating] }));
  await screen.findByRole("heading", { name: customerMessages.en.thanksHeading });
  return document.querySelector<HTMLElement>("[data-flow-screen='handoff']");
}

describe("one-tap customer flow", () => {
  it("sends every rating 1–5 to a byte-identical handoff and the same destination", async () => {
    const handoffMarkup: string[] = [];

    for (const rating of [1, 2, 3, 4, 5] as const) {
      const user = await openRating();
      const handoff = await tapStar(user, rating);
      expect(handoff).not.toBeNull();
      handoffMarkup.push(handoff?.outerHTML ?? "");

      await waitFor(() => expect(navigate).toHaveBeenCalledWith(FIXTURE_DESTINATION));
      expect(screen.queryByText(customerMessages.en.ratingLabels[rating])).not.toBeInTheDocument();

      cleanup();
      navigate.mockClear();
      window.sessionStorage.clear();
    }

    expect(new Set(handoffMarkup).size).toBe(1);
  });

  it("names the business above the stars until it uploads a photo", async () => {
    await openRating();

    // The fixture business has no photo. A blank dark half-page left a
    // customer with nothing saying whose counter code they had scanned.
    const fallback = document.querySelector<HTMLElement>("[data-hero-fallback]");
    expect(fallback).toHaveTextContent("Mario’s Pizza");
    expect(document.querySelector("[data-hero-layer] img")).toBeNull();
  });

  it("asks for nothing between the star and the destination", async () => {
    const user = await openRating();
    await tapStar(user, 2);

    // No confirm step, no note, no Team Praise, no way to decline the
    // destination: the only control on the handoff is the fallback link.
    const buttons = screen.queryAllByRole("button").map((button) => button.textContent);
    expect(buttons).toEqual([]);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/without|skip|no thanks/i);

    const link = document.querySelector<HTMLAnchorElement>("[data-destination-link]");
    expect(link?.getAttribute("href")).toBe(FIXTURE_DESTINATION);
  });

  it("records one session and one response for one tap", async () => {
    const user = await openRating();
    await tapStar(user, 3);

    const operations = window.__RB_FIXTURE_CALLS__?.map(({ operation }) => operation) ?? [];
    expect(operations.filter((operation) => operation === "session")).toHaveLength(1);
    expect(operations.filter((operation) => operation === "response")).toHaveLength(1);
  });

  it("does not submit twice when a star is tapped twice", async () => {
    const user = await openRating();
    const star = screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[4] });
    await user.dblClick(star);
    await screen.findByRole("heading", { name: customerMessages.en.thanksHeading });

    const responseCalls = window.__RB_FIXTURE_CALLS__?.filter(
      ({ operation }) => operation === "response",
    );
    expect(responseCalls).toHaveLength(1);
  });

  it("retains the rating and idempotency key after a recoverable failure", async () => {
    const user = await openRating("fixture-response-error");
    await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[2] }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Your rating is still here");
    expect(navigate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: customerMessages.en.tryAgain }));
    await screen.findByRole("heading", { name: customerMessages.en.thanksHeading });

    const responseKeys = window.__RB_FIXTURE_CALLS__
      ?.filter(({ operation }) => operation === "response")
      .map(({ idempotencyKey }) => idempotencyKey);
    expect(responseKeys).toHaveLength(2);
    expect(new Set(responseKeys).size).toBe(1);
  });

  it("holds the rating offline and submits it when connectivity returns", async () => {
    const user = await openRating();
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[1] }));

    expect(await screen.findByText(customerMessages.en.offline)).toBeVisible();

    await import("@testing-library/react").then(({ act }) =>
      act(async () => {
        Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
        window.dispatchEvent(new Event("online"));
      }),
    );
    await screen.findByRole("heading", { name: customerMessages.en.thanksHeading });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(FIXTURE_DESTINATION));
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
    const handoffHeading = screen.getByRole("heading", {
      name: customerMessages.en.thanksHeading,
    });
    await waitFor(() => expect(handoffHeading).toHaveFocus());
  });
});
