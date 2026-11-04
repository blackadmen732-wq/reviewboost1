import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ getSession: vi.fn(), signOut: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({ auth }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/ui/toast", () => ({ notify }));
import { ActionThread } from "@/features/dashboard/action-thread";
import { AddStandButton } from "@/features/dashboard/add-stand-button";
import { ResolveButton } from "@/features/dashboard/resolve-button";
import { SignOutButton } from "@/features/dashboard/sign-out-button";
import { DeleteAccountFlow } from "@/features/settings/delete-account-flow";

/**
 * When a change's answer is lost, the app finds out itself what happened, and
 * never does it twice: it reads what the server holds (a write is never sent
 * again by itself), then says done, or offers the action again. Nothing here
 * asks the owner to go and check.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

/** The method and path of every request, in order. */
function requests(fetcher: ReturnType<typeof vi.fn>): string[] {
  return fetcher.mock.calls.map(
    ([url, init]) => `${(init as RequestInit | undefined)?.method ?? "GET"} ${String(url)}`,
  );
}

async function pass(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  auth.getSession.mockResolvedValue({
    data: { session: { access_token: "test-owner" } },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("finds a note that was saved after all, and never saves it twice", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") throw new TypeError("Lost response");
    expect(url).toBe("/api/v1/customer-responses/response");
    return json({
      data: { notes: [{ noteId: "new-note", body: "Checked with the team" }] },
    });
  });
  vi.stubGlobal("fetch", fetcher);
  render(<ActionThread timeZone="UTC" responseId="response" actions={[]} />);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "Checked with the team" } });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));

  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""));
  expect(requests(fetcher)).toEqual([
    "POST /api/v1/customer-responses/response/notes",
    "GET /api/v1/customer-responses/response",
  ]);
  expect(refresh).toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("keeps a note that did not save, and offers Save again once it knows", async () => {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") throw new TypeError("Offline");
    return json({ data: { notes: [] } });
  });
  vi.stubGlobal("fetch", fetcher);
  render(<ActionThread timeZone="UTC" responseId="response" actions={[]} />);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Retain this note" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));

  await screen.findByText("Checking whether that went through…");
  // Held while it looks: a second tap could save the note twice.
  expect(screen.getByRole("button", { name: "Save note" })).toBeDisabled();
  await pass(10_000);
  await screen.findByText("That note didn’t save. Your text is still here. Try again.");
  expect(screen.getByRole("button", { name: "Save note" })).toBeEnabled();
  expect(screen.getByRole("textbox")).toHaveValue("Retain this note");
  expect(requests(fetcher).filter((r) => r.startsWith("POST"))).toHaveLength(1);
});

it("looks for a Tag made after all instead of asking the owner to", async () => {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") throw new TypeError("Offline");
    return json({
      data: [
        { standId: "old", locationId: "place" },
        { standId: "made-after-all", locationId: "place" },
      ],
    });
  });
  vi.stubGlobal("fetch", fetcher);
  render(
    <AddStandButton
      locations={[{ locationId: "place", name: "Test place" }]}
      standIds={["old"]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Create a Tag" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Label (optional)"), {
    target: { value: "Counter 2" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create a Tag" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(notify.success).toHaveBeenCalledWith("Tag created", expect.any(String));
  expect(requests(fetcher)).toEqual([
    "POST /api/v1/review-stands",
    "GET /api/v1/review-stands",
  ]);
});

it("offers Create again only once it knows no Tag was made", async () => {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") throw new TypeError("Offline");
    return json({ data: [{ standId: "old", locationId: "place" }] });
  });
  vi.stubGlobal("fetch", fetcher);
  render(
    <AddStandButton
      locations={[{ locationId: "place", name: "Test place" }]}
      standIds={["old"]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Create a Tag" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Create a Tag" }));
  await within(dialog).findByText("Checking whether that went through…");
  expect(within(dialog).getByRole("button", { name: "Create a Tag" })).toBeDisabled();
  await pass(10_000);
  await within(dialog).findByText("That Tag wasn’t created. Try again.");
  expect(within(dialog).getByRole("button", { name: "Create a Tag" })).toBeEnabled();
});

it("reads the feedback back after a lost “sorted”, and never sends it twice", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") throw new TypeError("Offline");
    expect(url).toBe("/api/v1/customer-responses/response");
    return json({ data: { isResolved: true } });
  });
  vi.stubGlobal("fetch", fetcher);
  render(<ResolveButton responseId="response" isResolved={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Mark as sorted" }));

  await waitFor(() => expect(notify.success).toHaveBeenCalledWith("Sorted", "Nice one."));
  expect(requests(fetcher)).toEqual([
    "POST /api/v1/customer-responses/response/resolve",
    "GET /api/v1/customer-responses/response",
  ]);
  expect(refresh).toHaveBeenCalled();
});

it("shows a recoverable sign-out error rather than staying busy", async () => {
  auth.signOut.mockRejectedValueOnce(new TypeError("Offline"));
  render(<SignOutButton />);
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
});

it("finds out whether a business was deleted after a lost answer, and never deletes twice", async () => {
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign });
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") throw new TypeError("Lost response");
    expect(url).toBe("/api/v1/locations");
    // The business is gone; the login stays (it has another business).
    return json({ error: { message: "Not found." } }, 404);
  });
  vi.stubGlobal("fetch", fetcher);
  render(<DeleteAccountFlow businessName="Test business" isOwner />);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Test business" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Delete this business" }));

  await waitFor(() => expect(assign).toHaveBeenCalledWith("/select-org"));
  expect(requests(fetcher).filter((r) => r.startsWith("POST"))).toHaveLength(1);
});

it("holds Delete while the server cannot be reached, and checks again by itself", async () => {
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign });
  let reachable = false;
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") throw new TypeError("Lost response");
    if (!reachable) throw new TypeError("Offline");
    // The login itself is gone: it was the owner's last business.
    return json({ error: { message: "Sign in." } }, 401);
  });
  vi.stubGlobal("fetch", fetcher);
  render(<DeleteAccountFlow businessName="Test business" isOwner />);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Test business" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Delete this business" }));

  await pass(10_000);
  await screen.findByText("No answer yet. Checking again in 10 s.");
  expect(screen.getByRole("button", { name: "Delete this business" })).toBeDisabled();
  expect(screen.queryByText(/check (your|my) businesses/i)).toBeNull();

  reachable = true;
  for (let second = 0; second < 10; second += 1) await pass(1_000);
  await waitFor(() => expect(assign).toHaveBeenCalledWith("/goodbye"));
  expect(auth.signOut).toHaveBeenCalled();
  expect(requests(fetcher).filter((r) => r.startsWith("POST"))).toHaveLength(1);
});
