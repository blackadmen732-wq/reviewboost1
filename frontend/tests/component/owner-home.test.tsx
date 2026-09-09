import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { OwnerHome } from "@/features/dashboard/owner-home";
import { deriveHomeModel, type HomeCounts, type HomeStand } from "@/features/dashboard/home-model";

const emptyCounts: HomeCounts = {
  ratingsToday: 0,
  unread: 0,
  activeStands: 0,
  recentCount: 0,
  hasGoogleLink: true,
};

const stand: HomeStand = {
  standId: "stand-1",
  label: "Counter",
  status: "active",
  nfcProvisionedAt: null,
  tokenRotatedAt: null,
};

describe("OwnerHome", () => {
  it("empty state is a name, one sentence, and one primary action", () => {
    const model = deriveHomeModel({
      counts: emptyCounts,
      stands: [],
      hasLocation: true,
    });

    render(<OwnerHome businessName="Oak & Vine" model={model} unreadItems={[]} />);

    expect(screen.getByRole("heading", { name: "Oak & Vine" })).toBeVisible();
    expect(screen.getByText("No ratings yet.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Create a Tag" })).toHaveAttribute("href", "/stands");
    expect(screen.queryByRole("link", { name: "Print your code" })).not.toBeInTheDocument();
    expect(screen.queryByText("Preview customer page")).not.toBeInTheDocument();
    expect(screen.queryByText("Praise")).not.toBeInTheDocument();
    expect(screen.queryByText("Customers")).not.toBeInTheDocument();
  });

  it("empty with a tag offers print and preview, not a second green CTA", () => {
    const model = deriveHomeModel({
      counts: emptyCounts,
      stands: [stand],
      hasLocation: true,
    });

    render(<OwnerHome businessName="Oak & Vine" model={model} unreadItems={[]} />);

    expect(screen.getByRole("link", { name: "Print your code" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Preview customer page" })).toBeVisible();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("returning home shows real unread rows and one green CTA", () => {
    const model = deriveHomeModel({
      counts: { ...emptyCounts, recentCount: 6, unread: 1 },
      stands: [stand],
      hasLocation: true,
    });

    render(
      <OwnerHome
        businessName="Oak & Vine"
        model={model}
        unreadItems={[
          {
            id: "r1",
            rating: 2,
            note: "Waited twenty minutes.",
            submittedAt: "2026-09-08T12:00:00.000Z",
            isRead: false,
            isResolved: false,
            noteCount: 0,
          },
        ]}
      />,
    );

    expect(screen.getByText("1 message needs you")).toBeVisible();
    expect(screen.getByText("Waited twenty minutes.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Read feedback" })).toHaveAttribute("href", "/feedback");
    expect(screen.getByText("1 tag · not programmed yet")).toBeVisible();
    expect(screen.queryByText("No ratings yet.")).not.toBeInTheDocument();
  });
});
