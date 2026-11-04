import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({
    auth: {
      signInWithOtp: vi.fn(),
      verifyOtp: vi.fn(),
    },
  }),
}));

import { SignInFlow } from "@/features/auth/sign-in-flow";

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
});
