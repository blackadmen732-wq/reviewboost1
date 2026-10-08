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

  it("has nothing to watch and nothing to press after the tap: no Sending, no Try again", () => {
    const sharedProps = { messages: customerMessages.en, rating: 1 as const, onRate: vi.fn() };
    const { rerender } = render(<RatingScreen {...sharedProps} status="leaving" />);
    // Already on its way: a second tap does nothing.
    expect(screen.getAllByRole("radio").every((radio) => (radio as HTMLInputElement).disabled)).toBe(true);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/Sending/)).not.toBeInTheDocument();

    rerender(<RatingScreen {...sharedProps} status="offline" />);
    expect(screen.getByRole("status")).toHaveTextContent(customerMessages.en.offline);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
