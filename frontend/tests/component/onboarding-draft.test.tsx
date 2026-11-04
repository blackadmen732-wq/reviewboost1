import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/toast", () => ({ notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({ auth: { getSession: vi.fn() } }),
}));

import { OnboardingFlow } from "@/features/onboarding/onboarding-flow";

/**
 * Nothing in setup reaches the server until its last step, and its Google
 * step sends the owner to Google to copy a link. A reload, or a phone dropping
 * the tab while they are away, used to put them back on step 1 with an empty
 * box. What they typed is kept for that tab.
 */
describe("Setup keeps what was typed", () => {
  afterEach(() => {
    window.sessionStorage.clear();
  });

  async function typeNameAndContinue(name: string) {
    fireEvent.change(await screen.findByLabelText(/business name/i), { target: { value: name } });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    await waitFor(() => expect(document.querySelector("[data-onboarding-step='google']")).toBeTruthy());
  }

  it("comes back on the Google step, with the link, after a reload", async () => {
    const first = render(<OnboardingFlow />);
    await typeNameAndContinue("Mario’s Pizza");
    fireEvent.change(screen.getByLabelText("Google review link"), {
      target: { value: "https://g.page/r/CTd8V7dQvVfAEBM/review" },
    });
    first.unmount();

    render(<OnboardingFlow />);
    await waitFor(() => expect(document.querySelector("[data-onboarding-step='google']")).toBeTruthy());
    expect(screen.getByLabelText("Google review link")).toHaveValue("https://g.page/r/CTd8V7dQvVfAEBM/review");

    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(await screen.findByLabelText(/business name/i)).toHaveValue("Mario’s Pizza");
  });

  it("starts empty when nothing was typed, and survives storage being refused", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    render(<OnboardingFlow />);
    expect(await screen.findByLabelText(/business name/i)).toHaveValue("");
    getItem.mockRestore();
  });
});
