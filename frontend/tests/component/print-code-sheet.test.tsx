import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({ notify: { error: vi.fn(), success: vi.fn() } }));
const getSession = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({ auth: { getSession } }),
}));
vi.mock("@/features/tags/program-tag-sheet", () => ({ ProgramTagSheet: () => null }));
vi.mock("@/features/dashboard/preview-customer-page", () => ({ PreviewCustomerPage: () => null }));

type QrStatus = "idle" | "loading" | "ready" | "expired" | "error";
const qr = vi.hoisted(() => ({
  state: {
    objectUrl: null as string | null,
    status: "loading" as QrStatus,
    reload: () => {},
    download: () => {},
    downloading: false,
  },
}));
vi.mock("@/lib/hooks/use-authenticated-qr", () => ({ useAuthenticatedQr: () => qr.state }));

import { OnboardingFlow } from "@/features/onboarding/onboarding-flow";
import { printedPlace } from "@/lib/owner/printed-place";
import { TagDetail } from "@/features/tags/tag-detail";
import type { Stand } from "@/lib/server/owner-data";

/**
 * "Print this code" used to print the whole app page: the header, the tiles,
 * the tab bar, and in dark mode light grey text on white paper. Now the paper
 * gets one sheet, rendered straight into <body> so the print stylesheet can
 * hide everything else. jsdom applies no print media, so the stylesheet's
 * half is checked as text at the bottom; the printed page itself was checked
 * as a PDF from Chromium, light and dark, Letter and A4.
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

/** The sheet where the print stylesheet looks for it: a direct child of <body>. */
const sheet = () => document.querySelector<HTMLElement>("body > [data-print-code]");

function setQr(status: QrStatus, objectUrl: string | null) {
  qr.state.status = status;
  qr.state.objectUrl = objectUrl;
}

beforeEach(() => {
  vi.spyOn(window, "print").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the printed code, from a Tag", () => {
  it("is the code, the business and the customer page's own question, and nothing of the app", () => {
    setQr("ready", "blob:code");
    render(<TagDetail timeZone="UTC" stand={stand} canManage businessName="Mario’s Pizza" />);

    const paper = sheet();
    expect(paper).not.toBeNull();
    expect(paper!.querySelector("img")?.getAttribute("src")).toBe("blob:code");
    // One place: every Tag there opens the same page, so no Tag name.
    expect(Array.from(paper!.querySelectorAll("p"), (p) => p.textContent)).toEqual([
      "Mario’s Pizza",
      "How was your visit?",
      "Scan with your phone’s camera",
    ]);
    expect(paper!.textContent).not.toContain("Front counter");
    expect(paper!.querySelector("button, a")).toBeNull();
    // No margin, so no address or date along the edges. In the sheet, not the
    // stylesheet: only a page that prints the sheet loses its margin.
    expect(paper!.querySelector("style")?.textContent).toBe("@page { margin: 0; }");
  });

  it("names the place at the foot when there is more than one", () => {
    // Each place can have its own Google link: the sheet says which it is for.
    setQr("ready", "blob:code");
    render(
      <TagDetail timeZone="UTC" stand={stand} canManage businessName="Mario’s Pizza" placeName="Downtown" />,
    );
    expect(sheet()!.lastElementChild?.textContent).toBe("Downtown");
  });

  it("prints from the Print tile", () => {
    setQr("ready", "blob:code");
    render(<TagDetail timeZone="UTC" stand={stand} canManage businessName="Mario’s Pizza" />);
    fireEvent.click(screen.getByRole("button", { name: /print this code/i }));
    expect(window.print).toHaveBeenCalledOnce();
  });

  it("holds no code while a new one loads: the dimmed one on screen no longer works", () => {
    setQr("loading", "blob:old-code");
    render(<TagDetail timeZone="UTC" stand={stand} canManage businessName="Mario’s Pizza" />);
    expect(sheet()).toBeNull();
    expect(screen.getByRole("button", { name: /print this code/i })).toBeDisabled();
  });

  it("holds nothing when the code could not load", () => {
    setQr("error", null);
    render(<TagDetail timeZone="UTC" stand={stand} canManage businessName="Mario’s Pizza" />);
    expect(sheet()).toBeNull();
  });

  it("is not there for a member or viewer, who cannot load the code", () => {
    setQr("ready", "blob:code");
    render(<TagDetail timeZone="UTC" stand={stand} canManage={false} businessName="Mario’s Pizza" />);
    expect(sheet()).toBeNull();
  });
});

describe("the place at the foot", () => {
  it("is named only when the business has more than one", () => {
    expect(printedPlace(1, "Downtown")).toBeUndefined();
    expect(printedPlace(2, "Downtown")).toBe("Downtown");
    // A count that could not be read: a name too many costs nothing.
    expect(printedPlace(null, "Downtown")).toBe("Downtown");
    expect(printedPlace(3, null)).toBeUndefined();
  });
});

describe("the printed code, from the last setup screen", () => {
  async function reachLastScreen() {
    getSession.mockResolvedValue({ data: { session: { access_token: "token" } } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: { standId: "stand-1", standUrl: "https://reviewboost.fit/q/x", organizationId: "org-1" },
        }),
      ),
    );
    const view = render(<OnboardingFlow />);
    fireEvent.change(await screen.findByLabelText(/business name/i), {
      target: { value: "  Mario’s Pizza " },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(await screen.findByRole("button", { name: /i will do this later/i }));
    await screen.findByRole("heading", { name: /your tag is made/i });
    return view;
  }

  it("waits for the code, then prints the same sheet with the business's name", async () => {
    setQr("loading", null);
    const view = await reachLastScreen();
    const print = screen.getByRole("button", { name: /print this code/i });
    // Printing before the code arrives would print the setup screen.
    expect(print).toBeDisabled();
    expect(sheet()).toBeNull();

    setQr("ready", "blob:first-code");
    view.rerender(<OnboardingFlow />);
    await waitFor(() => expect(sheet()).not.toBeNull());
    expect(sheet()!.querySelector("img")?.getAttribute("src")).toBe("blob:first-code");
    expect(Array.from(sheet()!.querySelectorAll("p"), (p) => p.textContent)).toEqual([
      "Mario’s Pizza",
      "How was your visit?",
      "Scan with your phone’s camera",
    ]);

    fireEvent.click(screen.getByRole("button", { name: /print this code/i }));
    expect(window.print).toHaveBeenCalledOnce();
  });
});

describe("the print stylesheet", () => {
  const css = readFileSync(join(process.cwd(), "styles/globals.css"), "utf8");
  const print = css.slice(css.indexOf("@media print {"));

  it("keeps the sheet off the screen", () => {
    expect(css).toMatch(/^\.print-code \{\s*display: none;\s*\}/m);
  });

  it("prints the sheet and nothing else, on white, whatever the theme", () => {
    expect(print).toMatch(/body:has\(> \.print-code\) > :not\(\.print-code\) \{\s*display: none !important;/);
    expect(print).toMatch(/\.print-code \{[^}]*display: flex;/);
    expect(print).toMatch(/background: #ffffff !important;/);
    expect(print).toMatch(/\.print-code \{[^}]*color: #111827;/);
  });

  it("sets no page margin of its own, so other pages print as they always did", () => {
    // Safari never matches a named @page, so the zero margin lives in the
    // mounted sheet instead (see the first test).
    expect(css).not.toMatch(/@page/);
  });

  it("lets the body end with the sheet, so a tall window prints no blank second page", () => {
    expect(print).toMatch(/html:has\(> body > \.print-code\) > body \{\s*min-height: 0 !important;/);
    // No rule in print sizes anything by the window (comments aside).
    expect(print.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/\d+d?vh/);
  });
});
