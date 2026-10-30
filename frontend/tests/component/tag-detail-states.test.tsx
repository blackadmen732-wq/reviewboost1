import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/ui/toast", () => ({ notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({ auth: { getSession: vi.fn() } }),
}));

const qrState = {
  objectUrl: null as string | null,
  status: "loading" as "idle" | "loading" | "ready" | "expired" | "error",
  reload: vi.fn(),
  download: vi.fn(),
  downloading: false,
};
vi.mock("@/lib/hooks/use-authenticated-qr", () => ({
  useAuthenticatedQr: () => qrState,
}));

// The sheet is driven by its own tests; here we only need its onReady prop.
let capturedOnReady: (() => void) | null = null;
vi.mock("@/features/tags/program-tag-sheet", () => ({
  ProgramTagSheet: ({ onReady }: { onReady: () => void }) => {
    capturedOnReady = onReady;
    return null;
  },
}));

import { TagDetail } from "@/features/tags/tag-detail";
import type { Stand } from "@/lib/server/owner-data";

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

function setQr(status: typeof qrState.status, objectUrl: string | null = null) {
  qrState.status = status;
  qrState.objectUrl = objectUrl;
}

describe("Tag detail code states", () => {
  afterEach(() => {
    vi.clearAllMocks();
    capturedOnReady = null;
  });

  /**
   * The view used to render `qr.objectUrl ? image : spinner`, collapsing every
   * non-ready state into one indefinite spinner — so an owner whose session had
   * expired watched it turn forever with nothing to press.
   */
  it("gives a member or viewer the Tag, not controls the API would refuse", () => {
    setQr("loading");
    render(<TagDetail stand={stand} canManage={false} />);

    expect(document.querySelector("[data-tag-access='read-only']")).toBeTruthy();
    // No code is requested: the QR route is owner/admin only.
    expect(document.querySelector("[data-qr-state]")).toBeNull();
    for (const name of [/print/i, /program nfc/i, /more/i, /preview customer page/i]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("spins only while actually loading", () => {
    setQr("loading");
    render(<TagDetail stand={stand} canManage />);

    expect(document.querySelector("[data-qr-state='loading']")).toBeTruthy();
    expect(document.querySelector("[data-qr-state='error']")).toBeNull();
  });

  it("offers a way back in when the session expired", () => {
    setQr("expired");
    render(<TagDetail stand={stand} canManage />);

    expect(document.querySelector("[data-qr-state='expired']")).toBeTruthy();
    expect(screen.getByText(/session expired/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /sign in again and retry/i })).toBeVisible();
    expect(document.querySelector("[data-qr-state='loading']")).toBeNull();
  });

  it("offers a retry when the code failed to load", () => {
    setQr("error");
    render(<TagDetail stand={stand} canManage />);

    expect(document.querySelector("[data-qr-state='error']")).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeVisible();
    expect(document.querySelector("[data-qr-state='loading']")).toBeNull();
  });

  it("shows the code once it is ready, and no spinner", () => {
    setQr("ready", "blob:code");
    render(<TagDetail stand={stand} canManage />);

    expect(screen.getByAltText(/code for front counter/i)).toBeVisible();
    expect(document.querySelector("[data-qr-state='loading']")).toBeNull();
  });

  it("says the printed copy is dead once the code has rotated", () => {
    setQr("ready", "blob:code");
    const rotated = {
      ...stand,
      nfcProvisionedAt: "2026-01-01T00:00:00Z",
      tokenRotatedAt: "2026-02-01T00:00:00Z",
    } as Stand;
    render(<TagDetail stand={rotated} canManage />);

    expect(document.querySelector("[data-qr-state='rotation-required']")).toBeTruthy();
    expect(screen.getByText(/no longer works/i)).toBeVisible();
  });
});

/**
 * Readiness has to move the moment a Tag is programmed.
 *
 * `onReady` was `() => undefined`, so the header kept saying "Needs NFC" after
 * a programming run the owner had just watched succeed.
 */
describe("Tag readiness after programming", () => {
  afterEach(() => {
    vi.clearAllMocks();
    capturedOnReady = null;
  });

  it("starts out needing NFC", () => {
    setQr("ready", "blob:code");
    render(<TagDetail stand={stand} canManage />);
    expect(screen.getByText(/NFC not programmed/)).toBeVisible();
  });

  it("stops saying NFC not programmed as soon as programming reports success", () => {
    setQr("ready", "blob:code");
    render(<TagDetail stand={stand} canManage />);
    expect(screen.getByText(/NFC not programmed/)).toBeVisible();

    expect(capturedOnReady).toBeTypeOf("function");
    act(() => capturedOnReady?.());

    expect(screen.queryByText(/NFC not programmed/)).not.toBeInTheDocument();
    expect(screen.getByText(/Ready/)).toBeVisible();
  });

  it("also asks the server for the authoritative version", () => {
    setQr("ready", "blob:code");
    render(<TagDetail stand={stand} canManage />);

    act(() => capturedOnReady?.());
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the current code on screen, dimmed, while a new one loads, and fades only a replaced code", () => {
    setQr("ready", "blob:first");
    const { container, rerender } = render(<TagDetail stand={stand} canManage />);
    expect(screen.getByAltText("Code for Front counter")).not.toHaveClass("animate-qr-in");

    setQr("loading", "blob:first");
    rerender(<TagDetail stand={stand} canManage />);
    expect(container.querySelector('[data-qr-state="replacing"] img')).toHaveAttribute("src", "blob:first");
    expect(screen.queryByLabelText("Loading code")).toBeNull();

    setQr("ready", "blob:second");
    rerender(<TagDetail stand={stand} canManage />);
    const code = screen.getByAltText("Code for Front counter");
    expect(code).toHaveAttribute("src", "blob:second");
    expect(code).toHaveClass("animate-qr-in");
  });
});
