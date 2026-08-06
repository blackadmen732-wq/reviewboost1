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
    "reveals the same optional note and Continue action for rating %s",
    async (rating) => {
      const user = userEvent.setup();
      const onRatingChange = vi.fn();
      const { rerender } = render(
        <RatingScreen
          businessName="Mario’s Pizza"
          messages={customerMessages.en}
          rating={null}
          note=""
          status="idle"
          onRatingChange={onRatingChange}
          onNoteChange={vi.fn()}
          onSubmit={vi.fn()}
        />,
      );

      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[rating] }));
      expect(onRatingChange).toHaveBeenCalledWith(rating);

      rerender(
        <RatingScreen
          businessName="Mario’s Pizza"
          messages={customerMessages.en}
          rating={rating}
          note=""
          status="idle"
          onRatingChange={onRatingChange}
          onNoteChange={vi.fn()}
          onSubmit={vi.fn()}
        />,
      );

      expect(screen.getByRole("textbox", { name: /want to add a note/i })).toBeVisible();
      expect(screen.getByRole("button", { name: "Continue" })).toBeVisible();
      expect(screen.getByText(customerMessages.en.ratingLabels[rating])).toBeVisible();
    },
  );

  it("keeps the chosen rating and note visible during submission and error", () => {
    const sharedProps = {
      businessName: "Mario’s Pizza",
      messages: customerMessages.en,
      rating: 1 as const,
      note: "The wait was long",
      onRatingChange: vi.fn(),
      onNoteChange: vi.fn(),
      onSubmit: vi.fn(),
    };
    const { rerender } = render(<RatingScreen {...sharedProps} status="submitting" />);
    expect(screen.getByRole("textbox")).toHaveValue("The wait was long");
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();

    rerender(<RatingScreen {...sharedProps} status="error" />);
    expect(screen.getByRole("textbox")).toHaveValue("The wait was long");
    expect(screen.getByRole("alert")).toHaveTextContent("Your feedback is still here");
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });
});

