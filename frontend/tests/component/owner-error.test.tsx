import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { forgetAllTries } from "@/lib/recovery/use-auto-retry";

/**
 * A page that fails tries again by itself, counting down: 3 s, 10 s, 30 s,
 * then it stops and says so. "Try now" skips the wait. Offline, it waits for
 * the connection instead of counting. Every try is Next's `retry`, which asks
 * the server again (`reset` only re-rendered what failed).
 */

function setOnline(online: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
  act(() => {
    window.dispatchEvent(new Event(online ? "online" : "offline"));
  });
}

/** A second at a time, letting React commit between ticks as it would live. */
function wait(seconds: number) {
  for (let second = 0; second < seconds; second += 1) {
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  forgetAllTries();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the owner error page", () => {
  it("keeps the tab bar, counts down, and tries again by itself", () => {
    const retry = vi.fn();
    render(<OwnerError error={new Error("first")} retry={retry} />);

    expect(screen.getByRole("heading", { name: "That didn’t load" })).toBeVisible();
    expect(screen.getByText("Trying again in 3 s.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try now" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeVisible();
    expect(screen.queryByText(/Something went wrong|first/i)).not.toBeInTheDocument();

    wait(1);
    expect(screen.getByText("Trying again in 2 s.")).toBeVisible();
    wait(2);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Trying again…", { selector: "p" })).toBeVisible();
  });

  it("waits longer after each failed try, then stops and hands over", () => {
    const retry = vi.fn();
    const { rerender } = render(<OwnerError error={new Error("1")} retry={retry} />);
    wait(3);
    expect(retry).toHaveBeenCalledTimes(1);

    // The try failed: Next renders the error page again with the new error.
    rerender(<OwnerError error={new Error("2")} retry={retry} />);
    expect(screen.getByText("Trying again in 10 s.")).toBeVisible();
    wait(10);
    expect(retry).toHaveBeenCalledTimes(2);

    rerender(<OwnerError error={new Error("3")} retry={retry} />);
    expect(screen.getByText("Trying again in 30 s.")).toBeVisible();
    wait(30);
    expect(retry).toHaveBeenCalledTimes(3);

    rerender(<OwnerError error={new Error("4")} retry={retry} />);
    expect(screen.getByRole("heading", { name: "Still not loading" })).toBeVisible();
    expect(screen.getByText("Wait a minute, then try again.")).toBeVisible();
    wait(120);
    expect(retry).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(4);
  });

  it("keeps counting when the page is made anew after a failed try", () => {
    const retry = vi.fn();
    const first = render(<OwnerError error={new Error("1")} retry={retry} />);
    wait(3);
    first.unmount();

    render(<OwnerError error={new Error("2")} retry={retry} />);
    // Not 3 s again: a page that keeps failing must not retry every 3 s forever.
    expect(screen.getByText("Trying again in 10 s.")).toBeVisible();
  });

  it("tries at once on Try now", () => {
    const retry = vi.fn();
    render(<OwnerError error={new Error("1")} retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try now" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("offline, waits for the connection instead of counting down", () => {
    const retry = vi.fn();
    setOnline(false);
    render(<OwnerError error={new Error("1")} retry={retry} />);

    expect(screen.getByRole("heading", { name: "You’re offline" })).toBeVisible();
    expect(screen.getByText("This loads again when you’re back online.")).toBeVisible();
    wait(60);
    expect(retry).not.toHaveBeenCalled();

    setOnline(true);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("never sits on “Trying again…”: a try with no answer counts as failed", () => {
    const retry = vi.fn();
    render(<OwnerError error={new Error("1")} retry={retry} />);
    wait(3);
    expect(retry).toHaveBeenCalledTimes(1);
    wait(20);
    expect(screen.getByText("Trying again in 10 s.")).toBeVisible();
  });
});

describe("the public error page", () => {
  it("is quiet, offers a way back, and tries again by itself", () => {
    const retry = vi.fn();
    render(<PublicError error={new Error("1")} retry={retry} />);

    expect(screen.getByRole("heading", { name: "That didn’t load" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Go to the homepage" })).toHaveAttribute("href", "/");
    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();

    wait(3);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("the customer page error", () => {
  it("tries again by itself, in the customer's language", () => {
    const retry = vi.fn();
    render(<CustomerReviewError error={new Error("1")} retry={retry} />);

    expect(screen.getByText("Trying again in 3 s.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try now" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("reads the countdown to a screen reader once, not every second", () => {
    render(<CustomerReviewError error={new Error("1")} retry={vi.fn()} />);
    const countdown = screen.getByText("Trying again in 3 s.");
    expect(countdown).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Trying again in a few seconds.")).toHaveClass("sr-only");
  });
});
