import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({ auth: { signOut: vi.fn() } }),
}));

import { ProviderAccountNotice } from "@/features/auth/provider-account-notice";

describe("ProviderAccountNotice", () => {
  it("explains Hide My Email and offers sign-out before a second business is made", () => {
    render(<ProviderAccountNotice provider="apple" email="x1y2@privaterelay.appleid.com" />);
    expect(screen.getByText("Signed in with Apple")).toBeVisible();
    expect(screen.getByText(/Apple is hiding your email/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  it("names the Google address the account belongs to", () => {
    render(<ProviderAccountNotice provider="google" email="mario@gmail.com" />);
    expect(screen.getByText(/new ReviewBoost account for mario@gmail.com/)).toBeVisible();
  });
});
