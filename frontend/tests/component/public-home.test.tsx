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

import { PublicHome } from "@/features/public/public-home";
import { INTEGRITY, PUBLIC_HERO, START_HREF } from "@/features/public/public-copy";

describe("PublicHome", () => {
  it("leads with the honest hero and one Action CTA", () => {
    render(<PublicHome />);

    expect(screen.getByRole("heading", { level: 1, name: PUBLIC_HERO.title })).toBeVisible();
    expect(screen.getByText(PUBLIC_HERO.lede)).toBeVisible();

    const starts = screen.getAllByRole("link", { name: "Get started" });
    expect(starts[0]).toHaveAttribute("href", START_HREF);
    expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toHaveAttribute("href", "/login");
  });

  it("states integrity without a price or a testimonial", () => {
    render(<PublicHome />);

    expect(screen.getByText(INTEGRITY.headline)).toBeVisible();
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/trusted by/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/reviews prevented/i)).not.toBeInTheDocument();
  });

  it("reuses the ReviewBoost logo placeholder in chrome", () => {
    render(<PublicHome />);

    expect(screen.getAllByText("ReviewBoost").length).toBeGreaterThan(0);
    expect(document.querySelector("[data-logo-pose='full']")).not.toBeNull();
  });
});
