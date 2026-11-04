import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/toast", () => ({ notify: { error: vi.fn(), success: vi.fn() } }));

const getSession = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({ auth: { getSession } }),
}));

import { OnboardingFlow } from "@/features/onboarding/onboarding-flow";
import { forgetAllTries } from "@/lib/recovery/use-auto-retry";

/**
 * Setup is the first screen of the product. It must never trap somebody.
 *
 * `finish()` set `busy` and then awaited the session lookup and the POST with
 * no try/catch, so a rejected request escaped the voided click handler: both
 * Continue and "I will do this later" stayed spinning and disabled, with no
 * error, and the only way out was a reload that loses what was typed.
 */
describe("Onboarding network recovery", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    forgetAllTries();
  });

  async function pass(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function reachGoogleStep() {
    render(<OnboardingFlow />);
    const name = await screen.findByLabelText(/business name|what is your business called/i);
    fireEvent.change(name, { target: { value: "Mario’s Pizza" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() =>
      expect(
        document.querySelector("[data-onboarding-step='google']"),
      ).toBeTruthy(),
    );
  }

  it("recovers from a dropped connection instead of stranding setup", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getSession.mockResolvedValue({ data: { session: { access_token: "token" } } });
    let connected = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (!connected) throw new TypeError("Failed to fetch");
        return new Response(
          JSON.stringify({ data: { hasOrganization: false, organization: null } }),
        );
      }),
    );

    await reachGoogleStep();
    fireEvent.click(screen.getByRole("button", { name: /i will do this later/i }));

    // The answer was lost, so the business may exist already: it looks before
    // anything can be pressed again, rather than make a second one.
    await screen.findByText("Checking whether that went through…");
    expect(screen.getByRole("button", { name: /i will do this later/i })).toBeDisabled();
    await pass(10_000);
    expect(await screen.findByRole("button", { name: "Check now" })).toBeEnabled();

    // The connection is back. The next check finds nothing was made, and
    // (the whole point) both ways forward are usable again.
    connected = true;
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    await pass(10_000);
    await screen.findByText("Your business wasn’t created. Try again.");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /i will do this later/i })).toBeEnabled(),
    );
  });

  it("recovers when the session lookup itself throws", async () => {
    getSession.mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", vi.fn());

    await reachGoogleStep();
    fireEvent.click(screen.getByRole("button", { name: /i will do this later/i }));

    await waitFor(() => expect(screen.getByText(/check your connection/i)).toBeVisible());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /i will do this later/i })).toBeEnabled(),
    );
  });

  it("still reports a refused name without hanging", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "token" } } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 409 })));

    await reachGoogleStep();
    fireEvent.click(screen.getByRole("button", { name: /i will do this later/i }));

    await waitFor(() => expect(screen.getByText(/already taken/i)).toBeVisible());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /i will do this later/i })).toBeEnabled(),
    );
  });
});
