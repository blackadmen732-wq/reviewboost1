import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerPageClient } from "@/features/customer-page/customer-page-client";
import { customerMessages, type RatingValue } from "@/lib/i18n/customer-messages";
import { renderWithProviders } from "@/tests/helpers/render";

/**
 * The customer flow, exercised the way a customer performs it.
 *
 * These tests drive real events rather than calling handlers, because the flow
 * depends on browser event order in a way a handler call cannot reproduce: a
 * radio fires `click` before `change`, so the commit runs before the selection
 * it is committing. That ordering has already broken this page once.
 */

const en = customerMessages.en;
const googleReviewUrl =
  "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4";

let assign: ReturnType<typeof vi.fn>;

beforeAll(() => {
  process.env.NEXT_PUBLIC_USE_CUSTOMER_FIXTURES = "true";
});

beforeEach(() => {
  assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign },
  });
});

afterEach(() => {
  setOnline(true);
});

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: online,
  });
}

function fixtureCalls(operation: string) {
  return (window.__RB_FIXTURE_CALLS__ ?? []).filter(
    (call) => call.operation === operation,
  );
}

async function openPage(token = "fixture-valid") {
  const user = userEvent.setup();
  renderWithProviders(<CustomerPageClient token={token} />);
  await screen.findByRole("heading", { name: en.question });
  // The question is on screen before the business is, so wait for the stars to
  // become live rather than for the sheet to exist.
  await waitFor(() => expect(star(1)).toBeEnabled(), { timeout: 5_000 });
  return user;
}

function star(rating: RatingValue) {
  return screen.getByRole("radio", { name: en.ratingSpoken[rating] });
}

describe("customer page — the one-tap path", () => {
  it("saves the private rating and opens Google from a single tap", async () => {
    const user = await openPage();

    await user.click(star(4));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(googleReviewUrl));
    expect(fixtureCalls("response")).toHaveLength(1);
    expect(star(4)).toBeChecked();
  });

  it("never redirects before the rating is saved", async () => {
    const user = await openPage("fixture-slow");
    const order: string[] = [];

    assign.mockImplementation(() => order.push("google"));
    await user.click(star(1));
    await waitFor(() => expect(assign).toHaveBeenCalled(), { timeout: 8_000 });

    for (const call of window.__RB_FIXTURE_CALLS__ ?? []) {
      if (call.operation === "response") order.unshift("response");
    }
    expect(order).toEqual(["response", "google"]);
  });

  it("shows the save while it is happening instead of a dead screen", async () => {
    // The regression that motivated this file: the selection dispatch used to
    // land after the save dispatch and reset it, so the page sat on the resting
    // instruction while a save was in flight — and a second tap was accepted.
    const user = await openPage("fixture-slow");

    await user.click(star(3));

    expect(await screen.findByText(en.opening, undefined, { timeout: 4_000 })).toBeVisible();
    expect(star(3)).toBeChecked();

    // See it through: a save still running when the test ends would redirect
    // during whichever test happens to be running when it lands.
    await waitFor(() => expect(assign).toHaveBeenCalled(), { timeout: 8_000 });
  });

  it("gives 1★ and 5★ the identical handoff", async () => {
    const destinations: string[] = [];
    const sheets: string[] = [];

    for (const rating of [1, 2, 3, 4, 5] as const) {
      const user = await openPage();
      await user.click(star(rating));
      await waitFor(() => expect(assign).toHaveBeenCalled());

      destinations.push(assign.mock.calls[0]?.[0]);
      // Everything except which stars are gold has to be the same page.
      sheets.push(
        (document.querySelector(".cp-sheet")?.outerHTML ?? "").replaceAll(
          /\s*data-filled="true"/g,
          "",
        ),
      );

      cleanup();
      window.sessionStorage.clear();
      assign.mockClear();
    }

    expect(new Set(destinations)).toEqual(new Set([googleReviewUrl]));
    expect(new Set(sheets).size).toBe(1);
  });
});

describe("customer page — when the save cannot go through", () => {
  it("keeps the stars, explains, and succeeds on retry without duplicating the rating", async () => {
    const user = await openPage("fixture-response-error");

    await user.click(star(2));

    expect(await screen.findByRole("alert")).toHaveTextContent(en.saveFailedHeading);
    expect(star(2)).toBeChecked();

    await user.click(screen.getByRole("button", { name: en.tryAgain }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(googleReviewUrl));

    // Two attempts, one rating: the retry reuses the key of the tap it retries.
    const keys = fixtureCalls("response").map((call) => call.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
  });

  it("holds an offline rating and sends it when the connection returns", async () => {
    const user = await openPage();
    setOnline(false);

    await user.click(star(5));

    expect(await screen.findByRole("alert")).toHaveTextContent(en.offlineHeading);
    expect(star(5)).toBeChecked();
    expect(assign).not.toHaveBeenCalled();

    setOnline(true);
    fireEvent(window, new Event("online"));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(googleReviewUrl));
  });

  it("asks a customer for nothing technical when the tag is dead", async () => {
    renderWithProviders(<CustomerPageClient token="fixture-inactive" />);

    expect(await screen.findByText(en.unavailableHeading)).toBeVisible();
    expect(screen.getByText(en.unavailableBody)).toBeVisible();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/404|token|database|error|invalid/i);
  });

  it("still takes a rating when the hero photograph fails", async () => {
    const user = await openPage("fixture-broken-photo");

    const photo = document.querySelector(".cp-hero__photo");
    expect(photo).not.toBeNull();
    fireEvent.error(photo as Element);

    expect(document.querySelector(".cp-hero")).toHaveAttribute("data-media", "neutral");
    await user.click(star(4));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(googleReviewUrl));
  });
});

describe("customer page — reaching it without a pointer", () => {
  it("lets an arrow key explore the stars without sending anyone to Google", async () => {
    const user = await openPage();

    star(1).focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");

    expect(star(3)).toBeChecked();
    expect(assign).not.toHaveBeenCalled();
    expect(fixtureCalls("response")).toHaveLength(0);
  });

  it("commits the chosen star on Enter", async () => {
    const user = await openPage();

    star(1).focus();
    await user.keyboard("{ArrowRight}{Enter}");

    await waitFor(() => expect(assign).toHaveBeenCalledWith(googleReviewUrl));
    expect(fixtureCalls("response")).toHaveLength(1);
  });

  it("commits on Space, the key the control already answers to", async () => {
    const user = await openPage();

    star(1).focus();
    await user.keyboard(" ");

    await waitFor(() => expect(assign).toHaveBeenCalledWith(googleReviewUrl));
  });
});

describe("customer page — language", () => {
  it("translates the whole sheet from the small hero control", async () => {
    const user = await openPage();

    await user.selectOptions(
      screen.getByRole("combobox", { name: en.language }),
      "ht",
    );

    expect(
      await screen.findByRole("heading", { name: customerMessages.ht.question }),
    ).toBeVisible();
    expect(screen.getByText(customerMessages.ht.tapInstruction)).toBeVisible();
    expect(document.documentElement.lang).toBe("ht");
  });

  it("offers no language control to a business with one language", async () => {
    await openPage("fixture-one-language");

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
