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
});
