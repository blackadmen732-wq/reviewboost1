import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * Deleting your own account, as the person sees it (launch gap L1).
 */

const auth = vi.hoisted(() => ({ getSession: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({ auth }),
}));

import { PersonalDeletionFlow } from "@/features/settings/personal-deletion-flow";
import { forgetAllTries } from "@/lib/recovery/use-auto-retry";

const assign = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  forgetAllTries();
  auth.getSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
  auth.signOut.mockResolvedValue({ error: null });
  vi.stubGlobal("location", { ...window.location, assign, reload: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

it("tells the only owner which business to delete first, before they type anything", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      json(200, { data: { allowed: false, blockers: [{ orgId: "o", name: "Solo Salon" }] } }),
    ),
  );
  render(<PersonalDeletionFlow />);
  await screen.findByText("Solo Salon");
  expect(screen.getByRole("link", { name: "Delete my business" })).toHaveAttribute(
    "href",
    "/settings/delete",
  );
  expect(screen.queryByRole("textbox")).toBeNull();
});

it("explains the missing word instead of a dead button, and sends nothing", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(json(200, { data: { allowed: true, blockers: [] } }));
  vi.stubGlobal("fetch", fetcher);
  render(<PersonalDeletionFlow />);
  const button = await screen.findByRole("button", { name: "Delete my account" });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  await screen.findByText("Type delete to confirm.");
  expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  expect(fetcher).toHaveBeenCalledTimes(1); // only the check
});

it("deletes, signs out and leaves", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json(200, { data: { allowed: true, blockers: [] } }))
    .mockResolvedValueOnce(json(200, { data: { deleted: true } }));
  vi.stubGlobal("fetch", fetcher);
  render(<PersonalDeletionFlow />);
  fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Delete" } });
  fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith("/goodbye"));
  expect(auth.signOut).toHaveBeenCalled();
  const [, init] = fetcher.mock.calls[1]!;
  expect(JSON.parse((init as RequestInit).body as string)).toEqual({ confirmation: "Delete" });
});

it("finds out itself whether a lost delete went through, and never deletes twice", async () => {
  // The check before, the delete (answer lost), then the read that finds the
  // login gone: a deleted login is refused.
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json(200, { data: { allowed: true, blockers: [] } }))
    .mockRejectedValueOnce(new TypeError("Lost response"))
    .mockResolvedValueOnce(json(401, { error: { message: "Sign in." } }));
  vi.stubGlobal("fetch", fetcher);
  render(<PersonalDeletionFlow />);
  fireEvent.change(await screen.findByRole("textbox"), { target: { value: "delete" } });
  fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith("/goodbye"));
  expect(auth.signOut).toHaveBeenCalled();
  const methods = fetcher.mock.calls.map(([, init]) => (init as RequestInit | undefined)?.method ?? "GET");
  expect(methods).toEqual(["GET", "POST", "GET"]);
  expect(screen.queryByText(/reload/i)).toBeNull();
});

it("holds Delete while it finds out, and offers it again once it knows nothing was deleted", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json(200, { data: { allowed: true, blockers: [] } }))
      .mockRejectedValueOnce(new TypeError("Lost response"))
      .mockResolvedValue(json(200, { data: { allowed: true, blockers: [] } }));
    vi.stubGlobal("fetch", fetcher);
    render(<PersonalDeletionFlow />);
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "delete" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    await screen.findByText("Checking whether that went through…");
    expect(screen.getByRole("button", { name: "Delete my account" })).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await screen.findByText("Your account was not deleted. Nothing changed. Try again.");
    expect(screen.getByRole("button", { name: "Delete my account" })).toBeEnabled();
    const posts = fetcher.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(posts).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

it("tries the first check again by itself when it could not reach the server", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Offline"))
      .mockResolvedValue(json(200, { data: { allowed: true, blockers: [] } }));
    vi.stubGlobal("fetch", fetcher);
    render(<PersonalDeletionFlow />);
    await screen.findByText(/Couldn’t check your account\. Nothing was deleted\./);
    expect(screen.getByText("Trying again in 3 s.")).toBeInTheDocument();
    for (let second = 0; second < 3; second += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
    }
    await screen.findByRole("textbox");
  } finally {
    vi.useRealTimers();
  }
});
