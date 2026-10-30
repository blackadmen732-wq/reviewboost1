import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ getSession: vi.fn(), signOut: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({ auth }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/ui/toast", () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));
import { ActionThread } from "@/features/dashboard/action-thread";
import { AddStandButton } from "@/features/dashboard/add-stand-button";
import { ResolveButton } from "@/features/dashboard/resolve-button";
import { SignOutButton } from "@/features/dashboard/sign-out-button";
import { DeleteAccountFlow } from "@/features/settings/delete-account-flow";

beforeEach(() => {
  vi.clearAllMocks();
  auth.getSession.mockResolvedValue({
    data: { session: { access_token: "test-owner" } },
  });
});
afterEach(() => vi.unstubAllGlobals());
it("preserves an uncertain note and checks a fresh thread before allowing a duplicate append", async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError("Lost response"));
  vi.stubGlobal("fetch", fetcher);
  const view = render(<ActionThread responseId="response" actions={[]} />);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "Checked with the team" } });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await screen.findByRole("alert");
  expect(input).toHaveValue("Checked with the team");
  expect(screen.getByRole("button", { name: "Save note" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Check saved notes" }));
  view.rerender(
    <ActionThread
      responseId="response"
      actions={[
        {
          noteId: "new-note",
          body: "Checked with the team",
          authorName: "Test owner",
          authorId: "test-owner",
          createdAt: "2026-10-14T00:00:00Z",
        },
      ]}
    />,
  );
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alert")).toBeNull();
});
it("recovers an uncertain note whose authoritative refreshed thread contains no new note", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Offline")));
  const view = render(<ActionThread responseId="response" actions={[]} />);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Retain this note" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Check saved notes" }));
  view.rerender(<ActionThread responseId="response" actions={[]} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save note" })).toBeEnabled(),
  );
  expect(screen.getByRole("textbox")).toHaveValue("Retain this note");
});
it("recovers create-Tag loading and checks Tags before permitting another creation", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Offline"))
    .mockResolvedValueOnce(new Response('{"data":[]}', { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  render(
    <AddStandButton
      locations={[{ locationId: "place", name: "Test place" }]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Create a Tag" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Label (optional)"), {
    target: { value: "Counter 2" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create a Tag" }));
  await screen.findByRole("alert");
  expect(
    within(dialog).getByRole("button", { name: "Create a Tag" }),
  ).toBeDisabled();
  expect(within(dialog).getByLabelText("Label (optional)")).toHaveValue(
    "Counter 2",
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Check your Tags" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(fetcher.mock.calls.map((c) => c[1]?.method ?? "GET")).toEqual([
    "POST",
    "GET",
  ]);
});
it("restores the sorted action after network failure and refreshes authoritative state", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Offline")));
  render(<ResolveButton responseId="response" isResolved={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Mark as sorted" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Mark as sorted" }),
    ).toBeEnabled(),
  );
  expect(refresh).toHaveBeenCalled();
});
it("shows a recoverable sign-out error rather than staying busy", async () => {
  auth.signOut.mockRejectedValueOnce(new TypeError("Offline"));
  render(<SignOutButton />);
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
});
it("does not promise rollback or repeat business deletion after a lost response", async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError("Lost response"));
  vi.stubGlobal("fetch", fetcher);
  render(<DeleteAccountFlow businessName="Test business" isOwner />);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Test business" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Delete this business" }));
  await screen.findByText(/could not confirm whether deletion finished/i);
  expect(
    screen.getByRole("button", { name: "Delete this business" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("link", { name: "Check my businesses" }),
  ).toHaveAttribute("href", "/select-org");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
