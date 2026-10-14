import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  }),
}));

vi.mock("@/components/ui/toast", () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));

import { GoogleLinkCare, TestGoogleLinkButton } from "@/features/dashboard/google-link-care";
import {
  GOOGLE_LINK_EMPTY,
  GOOGLE_LINK_INVALID,
  GOOGLE_LINK_LEGACY,
  GOOGLE_LINK_NOT_REVIEW_LINK,
} from "@/features/dashboard/google-link-copy";

const LOCATION_ID = "22222222-2222-2222-2222-222222222222";
const valid = "https://g.page/r/CornerCafe/review";
const legacy = "https://www.google.com/maps/place/Corner+Cafe";
const invalid = "https://evil.example/reviews";

describe("GoogleLinkCare", () => {
  it("offers no Change to a role that cannot save", () => {
    render(<GoogleLinkCare value={valid} locationId={LOCATION_ID} readOnly />);
    expect(screen.queryByRole("button", { name: /change/i })).not.toBeInTheDocument();
    expect(screen.getByText(/CornerCafe/)).toBeInTheDocument();
  });

  it("names a missing link and does not offer Open", () => {
    render(<GoogleLinkCare value={null} locationId={LOCATION_ID} />);

    expect(screen.getByText(GOOGLE_LINK_EMPTY)).toBeVisible();
    expect(document.querySelector("[data-google-link-state='missing']")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeVisible();
  });

  it("names an invalid saved link and refuses Open out loud", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    vi.stubGlobal("open", open);

    render(<GoogleLinkCare value={invalid} locationId={LOCATION_ID} />);

    expect(screen.getByText(invalid)).toBeVisible();
    expect(screen.getByText(GOOGLE_LINK_INVALID)).toBeVisible();
    expect(document.querySelector("[data-google-link-state='invalid']")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(open).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  it("opens a valid saved link", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    vi.stubGlobal("open", open);

    render(<GoogleLinkCare value={valid} locationId={LOCATION_ID} />);

    expect(document.querySelector("[data-google-link-state='valid']")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(open).toHaveBeenCalledWith(valid, "_blank", "noopener,noreferrer");
    vi.unstubAllGlobals();
  });

  it("keeps a legacy link working, and asks for the upgrade without calling it broken", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    vi.stubGlobal("open", open);

    render(<GoogleLinkCare value={legacy} locationId={LOCATION_ID} />);

    expect(document.querySelector("[data-google-link-state='legacy']")).not.toBeNull();
    const note = document.querySelector("[data-google-link-upgrade]");
    expect(note).toHaveAttribute("role", "status");
    expect(note).toHaveTextContent("Upgrade this link.");
    expect(note).toHaveTextContent(GOOGLE_LINK_LEGACY);
    // Working: no error, and Open still opens it.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(GOOGLE_LINK_INVALID)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(open).toHaveBeenCalledWith(legacy, "_blank", "noopener,noreferrer");
    // The way forward is named.
    expect(screen.getByRole("button", { name: "Upgrade" })).toBeVisible();
    vi.unstubAllGlobals();
  });

  it("refuses a pasted listing link as a new link, and says why", async () => {
    const user = userEvent.setup();
    render(<GoogleLinkCare value={legacy} locationId={LOCATION_ID} />);
    await user.click(screen.getByRole("button", { name: "Upgrade" }));
    const field = screen.getByLabelText("Google link");
    await user.clear(field);
    await user.type(field, "https://maps.app.goo.gl/abc123");
    expect(screen.getByRole("alert")).toHaveTextContent(GOOGLE_LINK_NOT_REVIEW_LINK);
    await user.clear(field);
    await user.type(field, valid);
    expect(screen.getByText("That is the right kind of link")).toBeVisible();
  });

  it("Test refuses a bad draft instead of doing nothing", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    vi.stubGlobal("open", open);

    render(<GoogleLinkCare value={null} locationId={LOCATION_ID} />);
    await user.click(screen.getByRole("button", { name: "Change" }));
    await user.type(screen.getByLabelText("Google link"), invalid);
    await user.click(screen.getByRole("button", { name: "Test" }));

    expect(open).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(GOOGLE_LINK_INVALID);
    vi.unstubAllGlobals();
  });
});

describe("TestGoogleLinkButton", () => {
  it("says why a missing or invalid Test will not open", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    vi.stubGlobal("open", open);

    const { rerender } = render(<TestGoogleLinkButton url="" />);
    await user.click(screen.getByRole("button", { name: "Test" }));
    expect(screen.getByRole("alert")).toHaveTextContent(GOOGLE_LINK_EMPTY);
    expect(open).not.toHaveBeenCalled();

    rerender(<TestGoogleLinkButton url={invalid} />);
    await user.click(screen.getByRole("button", { name: "Test" }));
    expect(screen.getByRole("alert")).toHaveTextContent(GOOGLE_LINK_INVALID);

    rerender(<TestGoogleLinkButton url={valid} />);
    await user.click(screen.getByRole("button", { name: "Test" }));
    expect(open).toHaveBeenCalledWith(valid, "_blank", "noopener,noreferrer");
    vi.unstubAllGlobals();
  });
});
