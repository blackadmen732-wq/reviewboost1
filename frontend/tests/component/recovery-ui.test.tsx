import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({ supabaseBrowser: () => ({ auth }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/home" }));
vi.mock("@/components/ui/toast", () => ({ notify }));
// The setup screen's code image is its own tests' business.
vi.mock("@/lib/hooks/use-authenticated-qr", () => ({
  useAuthenticatedQr: () => ({
    objectUrl: null,
    status: "loading",
    reload: () => {},
    download: () => {},
    downloading: false,
    failures: 0,
  }),
}));

import { Button } from "@/components/ui/button";
import { OfflineNotice } from "@/components/ui/offline-notice";
import { PreviewCustomerPage } from "@/features/dashboard/preview-customer-page";
import { OnboardingFlow } from "@/features/onboarding/onboarding-flow";
import { UnavailableRetry } from "@/features/public/unavailable-retry";
import { AddLocationButton } from "@/features/settings/add-location-button";
import { TextRequestComposer } from "@/features/dashboard/text-request-composer";
import { forgetAllTries } from "@/lib/recovery/use-auto-retry";

/**
 * The parts that make a slow or failed moment readable: a busy button that
 * says it is still working, a bar that says the connection is gone, and
 * changes that find out for themselves whether they went through.
 */

function setOnline(online: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
  act(() => {
    window.dispatchEvent(new Event(online ? "online" : "offline"));
  });
}

async function pass(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  forgetAllTries();
  auth.getSession.mockResolvedValue({ data: { session: { access_token: "owner" } } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("a busy button", () => {
  it("says “Still working…” after four seconds, keeping its size", async () => {
    render(
      <Button loading loadingLabel="Saving…">
        Save
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await pass(3_900);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeInTheDocument();
    await pass(200);
    const button = screen.getByRole("button", { name: "Still working…" });
    // Both labels stay in one grid cell, so the width does not jump.
    expect(button.querySelector("[data-still-working]")?.children).toHaveLength(2);
  });

  it("starts the four seconds again when its words move on (progress)", async () => {
    const { rerender } = render(
      <Button loading loadingLabel="Uploading… 10%">
        Add photo
      </Button>,
    );
    await pass(3_000);
    rerender(
      <Button loading loadingLabel="Uploading… 60%">
        Add photo
      </Button>,
    );
    await pass(3_000);
    expect(screen.getByRole("button", { name: "Uploading… 60%" })).toBeInTheDocument();
    await pass(1_100);
    expect(screen.getByRole("button", { name: "Still working…" })).toBeInTheDocument();
  });
});

describe("the offline bar", () => {
  it("says nothing will save while offline, then “Back online.” for three seconds", async () => {
    render(<OfflineNotice />);
    expect(screen.queryByRole("status")).toBeNull();

    setOnline(false);
    expect(screen.getByRole("status")).toHaveTextContent(
      "You’re offline. Nothing saves until you’re back.",
    );

    setOnline(true);
    expect(screen.getByRole("status")).toHaveTextContent("Back online.");
    await pass(3_100);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("a text request whose answer was lost", () => {
  const preview = {
    body: "Local shop: Thanks. https://example.test/q/test Reply STOP to opt out.",
    segments: 1,
    encoding: "gsm7",
    unitCount: 80,
    recipientLastFour: "0123",
    eligibility: { allowed: true, reason: null, message: null },
    consentStatement: "This customer agreed to receive a review request.",
  };

  async function sendOnce(recentAfter: Array<{ id: string; recipientLastFour: string }>) {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/preview")) return new Response(JSON.stringify({ data: preview }));
      if (init?.method === "POST") throw new TypeError("Lost response");
      return new Response(JSON.stringify({ data: { items: recentAfter } }));
    });
    vi.stubGlobal("fetch", fetcher);
    render(
      <TextRequestComposer
        timeZone="UTC"
        balance={{ monthly: 10, purchased: 0, total: 10 }}
        tags={[{ standId: "tag", label: "Counter", locationName: null }]}
        recent={[{ id: "old", status: "sent", segments: 1, recipientLastFour: "0123", createdAt: "2026-11-01T00:00:00Z" }]}
        canSendRequests
      />,
    );
    fireEvent.change(screen.getByLabelText("Customer's mobile number"), {
      target: { value: "+15555550123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview text request" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send text request" }));
    return fetcher;
  }

  const posts = (fetcher: ReturnType<typeof vi.fn>) =>
    fetcher.mock.calls.filter(
      ([url, init]) =>
        String(url) === "/api/v1/text-requests" &&
        (init as RequestInit | undefined)?.method === "POST",
    );

  it("looks under Recent and finds it, rather than send a second text", async () => {
    const fetcher = await sendOnce([
      { id: "new", recipientLastFour: "0123" },
      { id: "old", recipientLastFour: "0123" },
    ]);
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith("Scheduled", expect.any(String)));
    expect(posts(fetcher)).toHaveLength(1);
    expect(screen.queryByText(/Check Recent/i)).toBeNull();
  });

  it("says nothing was sent, and offers Send again, once it knows", async () => {
    const fetcher = await sendOnce([{ id: "old", recipientLastFour: "0123" }]);
    await screen.findByText("Checking whether that went through…");
    await pass(10_000);
    await screen.findByText("That text request didn’t go through. Nothing was sent. Try again.");
    expect(posts(fetcher)).toHaveLength(1);
    expect(notify.success).not.toHaveBeenCalled();
  });
});

describe("a place whose answer was lost", () => {
  it("looks for the new place, instead of asking the owner to", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") throw new TypeError("Lost response");
      return new Response(
        JSON.stringify({
          data: {
            locations: [
              { locationId: "main", name: "Main" },
              { locationId: "new", name: "Downtown" },
            ],
          },
        }),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    render(<AddLocationButton locationIds={["main"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a place" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Downtown" } });
    fireEvent.click(screen.getByRole("button", { name: "Add place" }));
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith("Place added", expect.any(String)));
    const methods = fetcher.mock.calls.map(([, init]) => (init as RequestInit | undefined)?.method ?? "GET");
    expect(methods).toEqual(["POST", "GET"]);
  });
});

describe("a part of a page that failed to load", () => {
  it("tries again by itself, and the link appears without a tap", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { standUrl: "https://reviewboost.fit/q/tag" } })),
      );
    vi.stubGlobal("fetch", fetcher);
    render(<PreviewCustomerPage standId="tag" />);
    await screen.findByText(/The customer page link didn’t load\./);
    expect(screen.getByText("Trying again in 3 s.")).toBeInTheDocument();
    for (let second = 0; second < 3; second += 1) await pass(1_000);
    // Marked as the owner's preview, so opening it records nothing.
    expect(await screen.findByRole("link", { name: /preview customer page/i })).toHaveAttribute(
      "href",
      "https://reviewboost.fit/q/tag?preview=1",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("the page for when ReviewBoost is not answering", () => {
  it("reloads the page asked for after 3 s, counting the try across the reload", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    sessionStorage.clear();
    render(<UnavailableRetry />);
    expect(screen.getByText("Trying again in 3 s.")).toBeInTheDocument();
    for (let second = 0; second < 3; second += 1) await pass(1_000);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem("rb-unavailable-tries") ?? "{}").count).toBe(1);
  });

  it("waits longer after each reload, then stops and hands over", () => {
    sessionStorage.setItem("rb-unavailable-tries", JSON.stringify({ count: 1, at: Date.now() }));
    const { unmount } = render(<UnavailableRetry />);
    expect(screen.getByText("Trying again in 10 s.")).toBeInTheDocument();
    unmount();
    forgetAllTries();
    sessionStorage.setItem("rb-unavailable-tries", JSON.stringify({ count: 3, at: Date.now() }));
    render(<UnavailableRetry />);
    expect(screen.getByText("Wait a minute, then try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    sessionStorage.clear();
  });
});

describe("setting up a business whose answer was lost", () => {
  it("finds the business it made instead of making a second one", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") throw new TypeError("Lost response");
      if (url === "/api/v1/onboarding") {
        return new Response(
          JSON.stringify({ data: { hasOrganization: true, organization: { id: "org-1" } } }),
        );
      }
      expect(url).toBe("/api/v1/review-stands");
      expect(new Headers(init?.headers).get("X-Organization-Id")).toBe("org-1");
      return new Response(JSON.stringify({ data: [{ standId: "stand-1" }] }));
    });
    vi.stubGlobal("fetch", fetcher);
    render(<OnboardingFlow />);
    fireEvent.change(await screen.findByLabelText(/business name/i), {
      target: { value: "Mario’s Pizza" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(await screen.findByRole("button", { name: /i will do this later/i }));

    await screen.findByRole("heading", { name: /your tag is made/i });
    const posts = fetcher.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(screen.queryByText(/already taken/i)).toBeNull();
  });

  it("offers setup again once it knows nothing was made", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") throw new TypeError("Lost response");
        return new Response(JSON.stringify({ data: { hasOrganization: false, organization: null } }));
      }),
    );
    render(<OnboardingFlow />);
    fireEvent.change(await screen.findByLabelText(/business name/i), {
      target: { value: "Mario’s Pizza" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(await screen.findByRole("button", { name: /i will do this later/i }));
    await screen.findByText("Checking whether that went through…");
    expect(screen.getByRole("button", { name: /i will do this later/i })).toBeDisabled();
    await pass(10_000);
    await screen.findByText("Your business wasn’t created. Try again.");
    expect(screen.getByRole("button", { name: /i will do this later/i })).toBeEnabled();
  });
});
