import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * Deleting your own account, as the person sees it (launch gap L1).
 */

const auth = vi.hoisted(() => ({ getSession: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({ auth }),
}));

import { PersonalDeletionFlow } from "@/features/settings/personal-deletion-flow";

const assign = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
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

it("never offers a second delete after a lost response", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json(200, { data: { allowed: true, blockers: [] } }))
    .mockRejectedValueOnce(new TypeError("Lost response"));
  vi.stubGlobal("fetch", fetcher);
  render(<PersonalDeletionFlow />);
  fireEvent.change(await screen.findByRole("textbox"), { target: { value: "delete" } });
  fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
  await screen.findByText(/couldn't confirm whether your account was deleted/i);
  expect(screen.queryByRole("button", { name: "Delete my account" })).toBeNull();
  expect(screen.getByRole("button", { name: "Reload to check" })).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
