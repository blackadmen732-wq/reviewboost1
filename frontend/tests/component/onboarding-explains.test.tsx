import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/toast", () => ({ notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({ auth: { getSession: vi.fn() } }),
}));

import { OnboardingFlow } from "@/features/onboarding/onboarding-flow";

/**
 * A greyed-out Continue gives an owner nothing to act on. The button is
 * always pressable and says what is missing instead (Vercel Web Interface
 * Guidelines: don't pre-disable submit; show the error where it applies).
 */
describe("Onboarding says what is missing", () => {
  afterEach(() => vi.clearAllMocks());

  it("asks for the business name instead of a dead button", async () => {
    render(<OnboardingFlow />);
    const continueButton = await screen.findByRole("button", { name: /continue/i });
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);
    expect(await screen.findByText("Enter your business name to continue.")).toBeVisible();
    expect(document.querySelector("[data-onboarding-step='google']")).toBeNull();
  });

  it("asks for the Google link, and moves on only when it is right", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<OnboardingFlow />);
    fireEvent.change(await screen.findByLabelText(/business name/i), { target: { value: "Mario’s Pizza" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(document.querySelector("[data-onboarding-step='google']")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(await screen.findByText(/paste your google link first/i)).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
