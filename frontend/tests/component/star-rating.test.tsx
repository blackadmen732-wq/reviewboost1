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
    "submits rating %s directly without a note or Continue action",
    async (rating) => {
      const user = userEvent.setup();
      const onRate = vi.fn();
      const { rerender } = render(
        <RatingScreen
          businessName="Mario’s Pizza"
          messages={customerMessages.en}
          rating={null}
          status="idle"
          onRate={onRate}
          onRetry={vi.fn()}
        />,
      );

      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[rating] }));
      expect(onRate).toHaveBeenCalledExactlyOnceWith(rating);

      rerender(
        <RatingScreen
          businessName="Mario’s Pizza"
          messages={customerMessages.en}
          rating={rating}
          status="idle"
          onRate={onRate}
          onRetry={vi.fn()}
        />,
      );

      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
      expect(
        screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[rating] }),
      ).toBeChecked();
      expect(screen.queryByText(customerMessages.en.ratingLabels[rating])).not.toBeInTheDocument();
    },
  );

  it("locks the chosen rating during submission and exposes retry after error", async () => {
    const user = userEvent.setup();
    const sharedProps = {
      businessName: "Mario’s Pizza",
      messages: customerMessages.en,
      rating: 1 as const,
      onRate: vi.fn(),
      onRetry: vi.fn(),
    };
    const { rerender } = render(<RatingScreen {...sharedProps} status="submitting" />);
    expect(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[1] })).toBeChecked();
    expect(screen.getAllByRole("radio").every((radio) => (radio as HTMLInputElement).disabled)).toBe(true);
    await user.click(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[2] }));
    expect(sharedProps.onRate).not.toHaveBeenCalled();

    rerender(<RatingScreen {...sharedProps} status="error" />);
    expect(screen.getByRole("radio", { name: customerMessages.en.ratingSpoken[1] })).toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent("Your feedback is still here");
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(sharedProps.onRetry).toHaveBeenCalledOnce();
  });
});
