import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";

import { CustomerFlow } from "@/features/customer-flow/customer-flow";
import { customerMessages, type RatingValue } from "@/lib/i18n/customer-messages";
import { renderWithProviders } from "@/tests/helpers/render";

beforeAll(() => {
  process.env.NEXT_PUBLIC_USE_CUSTOMER_FIXTURES = "true";
});

async function openRating(token = "fixture-valid") {
  const user = userEvent.setup();
  renderWithProviders(<CustomerFlow token={token} />);
  await screen.findByRole("heading", { name: customerMessages.en.ratingHeading });
  return user;
}

async function reachGoogle(user: ReturnType<typeof userEvent.setup>, rating: RatingValue) {
  await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[rating] }));
  await user.click(screen.getByRole("button", { name: customerMessages.en.continue }));
  await screen.findByRole("heading", { name: customerMessages.en.thanksHeading });
  return document.querySelector<HTMLElement>("[data-flow-screen='google-opportunity']");
}

describe("complete customer flow", () => {
  it("renders byte-identical Google opportunity markup after ratings 1–5", async () => {
    const googleMarkup: string[] = [];

    for (const rating of [1, 2, 3, 4, 5] as const) {
      const user = await openRating();
      const googleScreen = await reachGoogle(user, rating);
      expect(googleScreen).not.toBeNull();
      googleMarkup.push(googleScreen?.outerHTML ?? "");

      await user.click(
        within(googleScreen as HTMLElement).getByRole("button", {
          name: customerMessages.en.googleContinue,
        }),
      );
      // Google is the last thing V1 offers. Continuing past it ends the flow.
      expect(
        await screen.findByRole("heading", { name: customerMessages.en.doneHeading }),
      ).toBeVisible();
      expect(screen.queryByText(customerMessages.en.ratingLabels[rating])).not.toBeInTheDocument();
      cleanup();
      window.sessionStorage.clear();
    }

    expect(new Set(googleMarkup).size).toBe(1);
  });

  it("reaches the quiet finished state straight from Google", async () => {
    const user = await openRating();
    const googleScreen = await reachGoogle(user, 4);
    await user.click(
      within(googleScreen as HTMLElement).getByRole("button", {
        name: customerMessages.en.googleContinue,
      }),
    );

    const doneHeading = await screen.findByRole("heading", {
      name: customerMessages.en.doneHeading,
    });
    await waitFor(() => expect(doneHeading).toBeVisible());
    expect(screen.queryByText(/sign up|newsletter|download/i)).not.toBeInTheDocument();
    expect(window.sessionStorage.length).toBe(0);
  });

  it("asks the customer for nothing but the rating", async () => {
    const user = await openRating();

    // Before a rating, and after one, on every screen the flow can reach:
    // no text input anywhere. This is the V1 contract expressed as a journey
    // rather than as a schema assertion.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[3] }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    const googleScreen = await reachGoogle(user, 3);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await user.click(
      within(googleScreen as HTMLElement).getByRole("button", {
        name: customerMessages.en.googleContinue,
      }),
    );
    await screen.findByRole("heading", { name: customerMessages.en.doneHeading });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("blocks duplicate taps while preserving one logical response attempt", async () => {
    const user = await openRating();
    await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[3] }));
    await user.dblClick(screen.getByRole("button", { name: customerMessages.en.continue }));
    await screen.findByRole("heading", { name: customerMessages.en.thanksHeading });

    const responseCalls = window.__RB_FIXTURE_CALLS__?.filter(
      ({ operation }) => operation === "response",
    );
    expect(responseCalls).toHaveLength(1);
  });

  it("retains the rating and idempotency key after a recoverable failure", async () => {
    const user = await openRating("fixture-response-error");
    await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[2] }));
    await user.click(screen.getByRole("button", { name: customerMessages.en.continue }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Your feedback is still here");
    // The chosen rating survives the failure: a retry must not send a
    // different number than the one the customer is still looking at.
    expect(screen.getByText(customerMessages.en.ratingLabels[2])).toBeVisible();
    await user.click(screen.getByRole("button", { name: customerMessages.en.tryAgain }));
    await screen.findByRole("heading", { name: customerMessages.en.thanksHeading });

    const responseKeys = window.__RB_FIXTURE_CALLS__
      ?.filter(({ operation }) => operation === "response")
      .map(({ idempotencyKey }) => idempotencyKey);
    expect(responseKeys).toHaveLength(2);
    expect(new Set(responseKeys).size).toBe(1);
  });

  it("retains the draft offline and retries when connectivity returns", async () => {
    const user = await openRating();
    await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[1] }));
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    await user.click(screen.getByRole("button", { name: customerMessages.en.continue }));

    expect(await screen.findByText(customerMessages.en.offline)).toBeVisible();
    expect(screen.getByText(customerMessages.en.ratingLabels[1])).toBeVisible();

    await act(async () => {
      Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
      window.dispatchEvent(new Event("online"));
    });
    await screen.findByRole("heading", { name: customerMessages.en.thanksHeading });
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
    const user = await openRating();
    await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[5] }));
    expect(screen.queryByLabelText(/phone|email/i)).not.toBeInTheDocument();
    expect(document.querySelector("input[type='email'], input[type='tel']")).toBeNull();
    expect(document.body).not.toHaveTextContent(/newsletter|create an account|download the app/i);
  });

  it("moves focus to each new screen heading", async () => {
    const user = await openRating();
    const ratingHeading = screen.getByRole("heading", { name: customerMessages.en.ratingHeading });
    await waitFor(() => expect(ratingHeading).toHaveFocus());
    await reachGoogle(user, 3);
    const googleHeading = screen.getByRole("heading", { name: customerMessages.en.thanksHeading });
    await waitFor(() => expect(googleHeading).toHaveFocus());
  });
});
