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

import { PUBLIC_PLANS } from "@/features/public/pricing-plans";
import { PublicHome } from "@/features/public/public-home";
import { COMPARE, INTEGRITY, PUBLIC_HERO, SECURITY, START_HREF } from "@/features/public/public-copy";

describe("PublicHome", () => {
  it("leads with the honest hero and one Action CTA", () => {
    render(<PublicHome />);

    expect(screen.getByRole("heading", { level: 1, name: PUBLIC_HERO.title })).toBeVisible();
    expect(screen.getByText(PUBLIC_HERO.lede)).toBeVisible();

    const starts = screen.getAllByRole("link", { name: "Get started" });
    expect(starts[0]).toHaveAttribute("href", START_HREF);
    // The hero and the closing band name the offer itself.
    const trials = screen.getAllByRole("link", { name: PUBLIC_HERO.primary.label });
    expect(PUBLIC_HERO.primary.label).toBe("Start free trial");
    expect(trials.length).toBe(2);
    for (const link of trials) expect(link).toHaveAttribute("href", START_HREF);
    // Who it is for, said before anything else.
    expect(screen.getByText(PUBLIC_HERO.eyebrow)).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toHaveAttribute("href", "/login");
  });

  it("states integrity without a price or a testimonial", () => {
    render(<PublicHome />);

    expect(screen.getByText(INTEGRITY.headline)).toBeVisible();
    expect(screen.getByText(SECURITY.headline)).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Security" })[0]).toHaveAttribute("href", "/security");
    expect(screen.getAllByRole("link", { name: "Privacy" })[0]).toHaveAttribute("href", "/privacy");
    // No invented social proof. The product has no customers to quote yet, and
    // a fabricated one is the fastest way to make everything else look fake.
    expect(screen.queryByText(/trusted by/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/reviews prevented/i)).not.toBeInTheDocument();
  });

  /**
   * The homepage used to be asserted to contain NO price at all, which was the
   * right rule while the product had none. The offer is frozen now, and a
   * pricing section with no prices in it fails to answer the one question the
   * visitor came with.
   */
  it("shows the real prices, not invented ones", () => {
    render(<PublicHome />);

    for (const plan of PUBLIC_PLANS) {
      expect(screen.getByText(`$${plan.price}`)).toBeVisible();
    }
    // The trial is Starter's: seven days, a card, and not a free tier.
    expect(screen.getByText(/Starter free for 7 days/i)).toBeVisible();
    expect(screen.queryByText(/free forever/i)).not.toBeInTheDocument();
    // The FAQ does ask "Is there a free plan?" — and answers No. Matching the
    // phrase would fail on the denial, so this checks the offer instead: every
    // plan on the page costs money.
    expect(PUBLIC_PLANS.every((plan) => plan.price > 0)).toBe(true);
  });

  it("compares honestly: categories, no rival's name, no price we do not charge", () => {
    render(<PublicHome />);

    expect(screen.getByRole("heading", { name: COMPARE.headline })).toBeVisible();
    for (const option of COMPARE.options) {
      expect(screen.getByRole("heading", { level: 3, name: option.name })).toBeVisible();
    }
    const text = COMPARE.options.map((option) => `${option.price} ${option.body}`).join(" ");
    expect(text).not.toMatch(/podium|birdeye|nicejob|yelp/i);
    // The owner's screen is a picture, and says so.
    expect(screen.getByText(/Example · Home on the owner/)).toBeVisible();
  });

  it("reuses the ReviewBoost logo placeholder in chrome", () => {
    render(<PublicHome />);

    expect(screen.getAllByText("ReviewBoost").length).toBeGreaterThan(0);
    expect(document.querySelector("[data-logo-pose='full']")).not.toBeNull();
  });
});
