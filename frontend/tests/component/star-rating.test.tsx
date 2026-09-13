import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RatingScreen } from "@/features/customer-flow/screens/rating-screen";
import { StarRating } from "@/features/customer-flow/star-rating";
import { customerMessages } from "@/lib/i18n/customer-messages";

describe("StarRating", () => {
  it("is an unselected, keyboard-operable radio group with exact spoken labels", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <StarRating value={null} onChange={onChange} messages={customerMessages.en} />,
    );

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(5);
    expect(radios.every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(radios.map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "1 star — Not good",
      "2 stars — Could be better",
      "3 stars — Good",
      "4 stars — Great",
      "5 stars — Excellent",
    ]);

    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith(2);
  });
});

describe("RatingScreen", () => {
  it("shows no note textarea or Continue button", () => {
    render(
      <RatingScreen
        messages={customerMessages.en}
        rating={3}
        status="idle"
        onRatingChange={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /continue/i })).not.toBeInTheDocument();
  });

  it("shows 'Opening Google' while submitting", () => {
    render(
      <RatingScreen
        messages={customerMessages.en}
        rating={4}
        status="submitting"
        onRatingChange={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText(customerMessages.en.openingGoogle)).toBeVisible();
  });

  it("shows error with retry on failure", () => {
    render(
      <RatingScreen
        messages={customerMessages.en}
        rating={1}
        status="error"
        onRatingChange={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Your rating is still here");
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  it("shows offline notice when offline", () => {
    render(
      <RatingScreen
        messages={customerMessages.en}
        rating={2}
        status="offline"
        onRatingChange={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText(customerMessages.en.offline)).toBeVisible();
  });

  it("disables stars while submitting", () => {
    render(
      <RatingScreen
        messages={customerMessages.en}
        rating={5}
        status="submitting"
        onRatingChange={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const fieldset = document.querySelector("fieldset.star-rating");
    expect(fieldset).toHaveAttribute("disabled");
  });
});
