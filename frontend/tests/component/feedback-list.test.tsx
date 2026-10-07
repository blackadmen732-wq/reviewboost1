import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { FeedbackList } from "@/features/dashboard/feedback-list";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("FeedbackList", () => {
  it("shows gold only through stars, plus the real message", () => {
    const { container } = render(
      <FeedbackList
        items={[
          {
            id: "r1",
            rating: 2,
            note: "Soup was cold.",
            submittedAt: "2026-09-08T12:00:00.000Z",
            isRead: false,
            isResolved: false,
            noteCount: 0,
          },
        ]}
      />,
    );

    expect(screen.getByText("Soup was cold.")).toBeVisible();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/feedback/r1");
    expect(container.innerHTML).toContain("--rb-star");
    expect(container.innerHTML).not.toContain("sentiment");
  });

  it("marks unread, sorted and acted-on cards, whatever their stars", () => {
    render(
      <FeedbackList
        items={[
          { id: "new", rating: 1, note: null, submittedAt: "2026-09-08T12:00:00.000Z", isRead: false, isResolved: false, noteCount: 0 },
          { id: "done", rating: 5, note: null, submittedAt: "2026-09-07T12:00:00.000Z", isRead: true, isResolved: true, noteCount: 2 },
        ]}
      />,
    );

    const [unread, sorted] = screen.getAllByRole("link");
    expect(unread).toContainElement(screen.getByRole("img", { name: "Unread" }));
    expect(unread).not.toHaveTextContent("Sorted");
    expect(sorted).toHaveTextContent("Sorted");
    expect(sorted).toHaveTextContent("2 notes");
    // One unread dot in the list, and no "Rating only" filler on either card.
    expect(screen.getAllByRole("img", { name: "Unread" })).toHaveLength(1);
    expect(screen.queryByText(/rating only/i)).toBeNull();
  });
});
