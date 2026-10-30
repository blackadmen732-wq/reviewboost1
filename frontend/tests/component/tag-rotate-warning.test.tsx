import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const notify = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ notify }));
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
  }),
}));
vi.mock("@/lib/hooks/use-authenticated-qr", () => ({
  useAuthenticatedQr: () => ({
    objectUrl: "blob:code",
    status: "ready",
    reload: vi.fn(),
    download: vi.fn(),
    downloading: false,
  }),
}));
vi.mock("@/features/tags/program-tag-sheet", () => ({ ProgramTagSheet: () => null }));
vi.mock("@/lib/api/owner-fetch", () => ({
  ownerFetch: async () => new Response(JSON.stringify({ data: { standUrl: "https://reviewboost.fit/q/test" } })),
  SessionExpiredError: class extends Error {},
}));

import { ROTATE_NOT_NEEDED, ROTATE_WARNING, TagDetail } from "@/features/tags/tag-detail";
import type { Stand } from "@/lib/server/owner-data";

/**
 * "Make a new code" is the only action that invalidates a Tag already in the
 * field: the printed QR and the programmed NFC chip both stop working. The
 * confirmation has to say that, say what to do next, and say what does NOT
 * need it — so nobody makes a new code to "apply" a Google link or page change.
 */
const stand = {
  standId: "stand-1",
  label: "Front counter",
  locationName: "Downtown",
  standType: "qr",
  status: "active",
  tokenPrefix: "abc12345",
  tokenRotatedAt: null,
  nfcProvisionedAt: null,
  lastOpenedAt: null,
  locationId: "loc-1",
} as unknown as Stand;

async function openWarning(tag: Stand = stand) {
  const user = userEvent.setup();
  render(<TagDetail stand={tag} canManage />);
  await user.click(screen.getByRole("button", { name: "More" }));
  await user.click(screen.getByRole("button", { name: "Make a new code" }));
  return { user, dialog: await screen.findByRole("alertdialog") };
}

describe("Make a new code", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("warns that this is the only change that stops a Tag working — QR and NFC", async () => {
    const { dialog } = await openWarning();
    expect(within(dialog).getByRole("heading")).toHaveTextContent("Make a new code? The old one stops working.");
    expect(dialog).toHaveTextContent(ROTATE_WARNING);
    expect(ROTATE_WARNING).toMatch(/only change that stops a Tag working/);
    expect(ROTATE_WARNING).toMatch(/QR code you printed/);
    expect(ROTATE_WARNING).toMatch(/NFC chip you programmed/);
  });

  it("says what to do next: reprint, and reprogram NFC", async () => {
    const { dialog } = await openWarning();
    const steps = dialog.querySelector("[data-rotate-consequences]");
    expect(steps).toHaveTextContent("Print the new code and replace the one on the counter.");
    expect(steps).toHaveTextContent("If this Tag has an NFC chip, program it again.");
  });

  it("is specific when this Tag's NFC chip has been programmed", async () => {
    const { dialog } = await openWarning({ ...stand, nfcProvisionedAt: "2026-09-01T00:00:00.000Z" } as Stand);
    expect(dialog.querySelector("[data-rotate-consequences]")).toHaveTextContent(
      "Program this Tag’s NFC chip again.",
    );
  });

  it("says a Google link, Customer Page or place change never needs a new code", async () => {
    const { dialog } = await openWarning();
    expect(dialog.querySelector("[data-rotate-not-needed]")).toHaveTextContent(ROTATE_NOT_NEEDED);
    expect(ROTATE_NOT_NEEDED).toMatch(/Google link/);
    expect(ROTATE_NOT_NEEDED).toMatch(/Customer Page/);
    expect(ROTATE_NOT_NEEDED).toMatch(/place/);
  });

  it("keeps the code when the owner backs out: nothing is sent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { user, dialog } = await openWarning();
    await user.click(within(dialog).getByRole("button", { name: "Keep my code" }));
    expect(fetchMock.mock.calls.filter(([path]) => String(path).includes("rotate-token"))).toHaveLength(0);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("rotates exactly once on confirm, and says the old code no longer works", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { user, dialog } = await openWarning();
    await user.click(within(dialog).getByRole("button", { name: "Make a new code" }));
    await waitFor(() => expect(notify.success).toHaveBeenCalled());
    const calls = fetchMock.mock.calls.map((call) => String((call as unknown[])[0]));
    expect(calls.filter((url) => url.endsWith("/rotate-token"))).toHaveLength(1);
    expect(notify.success).toHaveBeenCalledWith(
      "New code ready",
      "The old code no longer works. Print this one and program NFC again.",
    );
  });
});
