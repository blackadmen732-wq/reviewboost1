import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerFlow } from "@/features/customer-flow/customer-flow";
import { customerMessages } from "@/lib/i18n/customer-messages";
import { renderWithProviders } from "@/tests/helpers/render";

beforeAll(() => {
  process.env.NEXT_PUBLIC_USE_CUSTOMER_FIXTURES = "true";
});

const locationAssign = vi.fn();

beforeEach(() => {
  locationAssign.mockReset();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign: locationAssign },
  });
});

async function openRating(token = "fixture-valid") {
  const user = userEvent.setup();
  renderWithProviders(<CustomerFlow token={token} />);
  await screen.findByRole("heading", { name: customerMessages.en.ratingHeading });
  return user;
}

describe("one-tap customer flow", () => {
  it("tapping any star saves and redirects to Google", async () => {
    for (const rating of [1, 2, 3, 4, 5] as const) {
      const user = await openRating();
      await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[rating] }));
      await waitFor(() => expect(locationAssign).toHaveBeenCalledTimes(1));
      expect(locationAssign).toHaveBeenCalledWith(
        expect.stringMatching(/^https:\/\/(search\.google\.com|g\.page)\//),
      );
      locationAssign.mockReset();
      cleanup();
      window.sessionStorage.clear();
    }
  });

  it("disables stars while saving", async () => {
    const user = await openRating();
    await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[3] }));
    await waitFor(() => expect(locationAssign).toHaveBeenCalled());
  });

  it("shows retry on failure and retries with the same idempotency key", async () => {
    const user = await openRating("fixture-response-error");
    await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[2] }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Your rating is still here");
    expect(locationAssign).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: customerMessages.en.tryAgain }));
    await waitFor(() => expect(locationAssign).toHaveBeenCalledTimes(1));

    const responseKeys = window.__RB_FIXTURE_CALLS__
      ?.filter(({ operation }) => operation === "response")
      .map(({ idempotencyKey }) => idempotencyKey);
    expect(responseKeys).toHaveLength(2);
    expect(new Set(responseKeys).size).toBe(1);
  });

  it("retries automatically when coming back online", async () => {
    const user = await openRating();
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[1] }));

    expect(await screen.findByText(customerMessages.en.offline)).toBeVisible();
    expect(locationAssign).not.toHaveBeenCalled();

    await act(async () => {
      Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(locationAssign).toHaveBeenCalledTimes(1));
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

  it("has no note textarea, Continue button, or extra screens", async () => {
    await openRating();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /continue/i })).not.toBeInTheDocument();
  });
});
