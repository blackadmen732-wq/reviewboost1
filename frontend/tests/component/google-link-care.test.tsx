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
} from "@/features/dashboard/google-link-copy";

const valid = "https://g.page/corner-cafe";
const invalid = "https://evil.example/reviews";

describe("GoogleLinkCare", () => {
  it("names a missing link and does not offer Open", () => {
    render(<GoogleLinkCare value={null} />);

    expect(screen.getByText(GOOGLE_LINK_EMPTY)).toBeVisible();
    expect(document.querySelector("[data-google-link-state='missing']")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeVisible();
  });

  it("names an invalid saved link and refuses Open out loud", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    vi.stubGlobal("open", open);

    render(<GoogleLinkCare value={invalid} />);

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

    render(<GoogleLinkCare value={valid} />);

    expect(document.querySelector("[data-google-link-state='valid']")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(open).toHaveBeenCalledWith(valid, "_blank", "noopener,noreferrer");
    vi.unstubAllGlobals();
  });

  it("Test refuses a bad draft instead of doing nothing", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    vi.stubGlobal("open", open);

    render(<GoogleLinkCare value={null} />);
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
