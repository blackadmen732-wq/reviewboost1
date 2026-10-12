import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithOAuth = vi.fn();

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({
    auth: {
      signInWithOtp: vi.fn(),
      verifyOtp: vi.fn(),
      signInWithOAuth,
    },
  }),
}));

import { SignInFlow } from "@/features/auth/sign-in-flow";

beforeEach(() => {
  signInWithOAuth.mockReset();
});

describe("SignInFlow", () => {
  it("says Sign in on the returning door", () => {
    render(<SignInFlow next="/home" />);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(document.querySelector("[data-auth-intent='signin']")).not.toBeNull();
  });

  it("says Get started when the next stop is onboarding", () => {
    render(<SignInFlow next="/onboarding" intent="start" />);
    expect(screen.getByRole("heading", { name: "Get started" })).toBeVisible();
    expect(document.querySelector("[data-auth-intent='start']")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Continue" })).toBeVisible();
  });

  it("offers a way out", () => {
    render(<SignInFlow next="/home" />);
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/");
  });

  it("shows no provider buttons and no divider when none is switched on", () => {
    render(<SignInFlow next="/home" />);
    expect(screen.queryByRole("button", { name: /Continue with/ })).toBeNull();
    expect(screen.queryByText("or")).toBeNull();
  });

  it("shows Apple then Google when both are on", () => {
    render(<SignInFlow next="/home" providers={["apple", "google"]} />);
    const buttons = screen.getAllByRole("button", { name: /Continue with/ });
    expect(buttons.map((b) => b.textContent)).toEqual(["Continue with Apple", "Continue with Google"]);
  });

  it("starts Apple sign-in through Supabase and returns to the same destination", async () => {
    signInWithOAuth.mockResolvedValue({ data: {}, error: null });
    render(<SignInFlow next="/customer-page" providers={["apple", "google"]} />);
    await userEvent.click(screen.getByRole("button", { name: "Continue with Apple" }));
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "apple",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=%2Fcustomer-page` },
    });
    expect(screen.getByRole("button", { name: "Opening…" })).toHaveAttribute("aria-busy", "true");
  });

  it("says so when a provider cannot start, and lets the owner try again", async () => {
    signInWithOAuth.mockResolvedValue({ data: {}, error: { message: "provider disabled" } });
    render(<SignInFlow next="/home" providers={["google"]} />);
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("didn’t go through");
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  });

  it("treats a cancelled sheet as information, not an error", () => {
    render(<SignInFlow next="/home" providers={["apple"]} oauthError="cancelled" />);
    expect(screen.getByRole("status")).toHaveTextContent("Sign-in was cancelled");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
