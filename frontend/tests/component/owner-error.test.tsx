import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

import CustomerReviewError from "@/app/(customer)/q/[token]/error";
import OwnerError from "@/app/(owner)/error";
import PublicError from "@/app/error";

/**
 * Every "Try again" calls Next's `retry`, which fetches the page from the
 * server again. They called `reset`, which only re-renders what failed: a
 * page that failed on a server read failed again on every tap.
 */

describe("error states", () => {
  it("owner error keeps chrome and one Try again action", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();

    render(<OwnerError retry={retry} />);

    expect(screen.getByText("That did not work")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("public error is quiet and offers a way back", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();

    render(<PublicError retry={retry} />);

    expect(screen.getByRole("heading", { name: "That did not work" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Go to the homepage" })).toHaveAttribute("href", "/");
    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("customer page error asks the server again", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();

    render(<CustomerReviewError retry={retry} />);

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
