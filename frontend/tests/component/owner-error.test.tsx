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

import OwnerError from "@/app/(owner)/error";
import PublicError from "@/app/error";

describe("error states", () => {
  it("owner error keeps chrome and one Try again action", async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<OwnerError reset={reset} />);

    expect(screen.getByText("That did not work")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("public error is quiet and offers a way back", async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<PublicError reset={reset} />);

    expect(screen.getByRole("heading", { name: "That did not work" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Go to the homepage" })).toHaveAttribute("href", "/");
    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
