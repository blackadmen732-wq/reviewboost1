import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
}));

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

import { BottomNav } from "@/features/dashboard/bottom-nav";
import { DesktopSidebar } from "@/features/dashboard/desktop-sidebar";

describe("owner chrome", () => {
  it("mobile is four tabs: Home, Feedback, Text Requests, Tags", () => {
    render(<BottomNav unreadCount={2} />);

    const nav = screen.getByRole("navigation", { name: "Main" });
    const links = screen.getAllByRole("link");

    expect(nav.className).toMatch(/lg:hidden/);
    expect(links).toHaveLength(4);
    expect(links[0]).toHaveAttribute("href", "/home");
    expect(links[1]).toHaveAttribute("href", "/feedback");
    expect(links[2]).toHaveAttribute("href", "/text-requests");
    expect(links[3]).toHaveAttribute("href", "/stands");
    expect(screen.getByText("Home")).toBeVisible();
    expect(screen.getByText("Feedback")).toBeVisible();
    expect(screen.getByText("Text Requests")).toBeVisible();
    expect(screen.getByText("Tags")).toBeVisible();
    expect(screen.getByLabelText("2 unread")).toBeVisible();
    expect(screen.queryByText("Team")).not.toBeInTheDocument();
    expect(screen.queryByText("Customers")).not.toBeInTheDocument();
    expect(screen.queryByText("Praise")).not.toBeInTheDocument();
  });

  it("desktop sidebar is Home, Feedback, Text Requests, Tags, Settings", () => {
    render(<DesktopSidebar unreadCount={2} businessName="Oak & Vine" />);

    const aside = screen.getByRole("complementary", { name: "Main" });
    expect(aside.className).toMatch(/lg:flex/);
    expect(aside.className).toMatch(/hidden/);

    expect(screen.getByRole("link", { name: "ReviewBoost home" })).toBeVisible();
    expect(screen.getByText("Home")).toBeVisible();
    expect(screen.getByText("Feedback")).toBeVisible();
    expect(screen.getByText("Text Requests")).toBeVisible();
    expect(screen.getByText("Tags")).toBeVisible();
    expect(screen.getByText("Settings")).toBeVisible();
    expect(screen.getByText("Oak & Vine")).toBeVisible();
    expect(screen.getByLabelText("2 unread")).toBeVisible();
    expect(screen.queryByText("Customers")).not.toBeInTheDocument();
    expect(screen.queryByText("Praise")).not.toBeInTheDocument();
    expect(screen.queryByText("Team")).not.toBeInTheDocument();
  });
});
