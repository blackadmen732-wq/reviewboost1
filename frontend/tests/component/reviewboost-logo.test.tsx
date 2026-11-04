import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReviewBoostLogo } from "@/components/brand/reviewboost-logo";

describe("ReviewBoostLogo", () => {
  it("full nav pose is mark plus wordmark", () => {
    const { container } = render(<ReviewBoostLogo pose="full" size="nav" />);
    expect(container.querySelector("[data-logo-pose='full']")).not.toBeNull();
    expect(container.querySelector("[data-logo-size='nav']")).not.toBeNull();
    expect(screen.getByText("ReviewBoost")).toBeVisible();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("mark pose has an accessible name without a visible wordmark", () => {
    render(<ReviewBoostLogo pose="mark" size="footer" />);
    expect(screen.getByText("ReviewBoost")).toHaveClass("sr-only");
  });

  it("poweredBy pose includes the credit line", () => {
    render(<ReviewBoostLogo pose="poweredBy" size="poweredBy" />);
    expect(screen.getByText("Powered by")).toBeVisible();
    expect(screen.getByText("ReviewBoost")).toBeVisible();
  });
});
