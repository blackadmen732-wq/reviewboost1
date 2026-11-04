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
  it.each([1, 2, 3, 4, 5] as const)(
    "submits rating %s on the tap itself, with no confirm step",
    async (rating) => {
      const user = userEvent.setup();
      const onRate = vi.fn();
      render(
        <RatingScreen
          messages={customerMessages.en}
          rating={null}
          status="idle"
          onRate={onRate}
          onRetry={vi.fn()}
        />,
      );

      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      await user.click(
        screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[rating] }),
      );
      expect(onRate).toHaveBeenCalledWith(rating);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );

  it.each(["{Enter}", " "])(
    "lets a keyboard user move with the arrows, then choose with %s",
    async (key) => {
      // An arrow used to select, and selecting submits: → from the first star
      // sent 2 stars to Google. Arrows now only move (WCAG 3.2.2).
      const user = userEvent.setup();
      const onRate = vi.fn();
      render(
        <RatingScreen messages={customerMessages.en} rating={null} status="idle" onRate={onRate} onRetry={vi.fn()} />,
      );
      await user.tab();
      expect(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[1] })).toHaveFocus();

      await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
      expect(onRate).not.toHaveBeenCalled();
      expect(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[4] })).toHaveFocus();
      await user.keyboard("{ArrowLeft}{ArrowRight}");
      expect(onRate).not.toHaveBeenCalled();

      await user.keyboard(key);
      expect(onRate).toHaveBeenCalledTimes(1);
      expect(onRate).toHaveBeenCalledWith(4);
    },
  );

  it("offers recovery — and only recovery — after a failed submit", () => {
    const sharedProps = {
      messages: customerMessages.en,
      rating: 1 as const,
      onRate: vi.fn(),
      onRetry: vi.fn(),
    };
    const { rerender } = render(<RatingScreen {...sharedProps} status="submitting" />);
    expect(screen.getByRole("status")).toHaveTextContent("Sending…");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    rerender(<RatingScreen {...sharedProps} status="error" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Your rating is still here");
    // It sends the rating again by itself, and says when; "Try now" skips the wait.
    expect(screen.getByRole("alert")).toHaveTextContent("Trying again in 3 s.");
    expect(screen.getByRole("button", { name: "Try now" })).toBeEnabled();
  });
});
