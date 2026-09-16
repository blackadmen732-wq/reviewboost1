import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({
  notify: { error: vi.fn(), success: vi.fn() },
}));

const getSession = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({ auth: { getSession } }),
}));

import { GoogleLinkCare } from "@/features/dashboard/google-link-care";

/**
 * The Google link is the one field whose absence stops every Tag working, so
 * failing to save it must always be recoverable.
 *
 * The session lookup and the PATCH sat outside any try/catch with `busy` set
 * beforehand. A dropped connection or an auth error threw straight out of
 * `save()`, leaving the button in its loading state with no way back but a page
 * reload.
 */
describe("Google link network recovery", () => {
  const VALID = "https://g.page/r/abcdef/review";

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  function signedIn() {
    getSession.mockResolvedValue({ data: { session: { access_token: "token" } } });
  }

  async function startEditing() {
    render(<GoogleLinkCare value={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /add|edit|save|change/i }));
  }

  async function typeAndSave() {
    const field = await screen.findByLabelText(/google link/i);
    fireEvent.change(field, { target: { value: VALID } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
  }

  it("recovers from a dropped connection instead of hanging", async () => {
    signedIn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    await startEditing();
    await typeAndSave();

    await waitFor(() => expect(screen.getByText(/check your connection/i)).toBeVisible());
    // The whole point: Save is pressable again.
    await waitFor(() => expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled());
  });

  it("recovers when the session lookup itself throws", async () => {
    getSession.mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", vi.fn());

    await startEditing();
    await typeAndSave();

    await waitFor(() => expect(screen.getByText(/check your connection/i)).toBeVisible());
    await waitFor(() => expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled());
  });

  it("says so, and stays retryable, when the session has expired", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    vi.stubGlobal("fetch", vi.fn());

    await startEditing();
    await typeAndSave();

    await waitFor(() => expect(screen.getByText(/session expired/i)).toBeVisible());
    await waitFor(() => expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled());
  });

  it("surfaces the server's own refusal and clears busy", async () => {
    signedIn();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { details: [{ message: "That is not a Google review link." }] } }),
            { status: 422 },
          ),
      ),
    );

    await startEditing();
    await typeAndSave();

    await waitFor(() =>
      expect(screen.getByText(/not a google review link/i)).toBeVisible(),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled());
  });

  it("writes the generic destination, not the old google field", async () => {
    signedIn();
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await startEditing();
    await typeAndSave();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // vi.fn() over a zero-arg body still records what it was called with; the
    // cast is only to read the RequestInit the component passed.
    const [, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ destinationProvider: "google", destinationUrl: VALID });
    expect(body).not.toHaveProperty("googleReviewUrl");
  });
});
