import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
  }),
}));

import { CustomerPageEditor } from "@/features/customer-page/customer-page-editor";
import { customerMessages } from "@/lib/i18n/customer-messages";

describe("Customer page editor", () => {
  it("shows the live customer view in the phone, not a sketch", () => {
    render(
      <CustomerPageEditor
        initial={{
          draft: { x: 0, y: 0, scale: 1 },
          draftTagline: null,
          hasDraftHero: false,
          hasPublishedHero: false,
          publishedAt: null,
          draftArtworkUrl: "/api/v1/customer-page/artwork?side=draft",
        }}
      />,
    );

    expect(screen.getByText(customerMessages.en.ratingHeading)).toBeVisible();
    expect(screen.getByText(customerMessages.en.ratingSupport)).toBeVisible();
    expect(screen.getByText(customerMessages.en.footerPromise)).toBeVisible();
    expect(screen.getByRole("img", { name: "Customer page" })).toBeInTheDocument();
    expect(document.querySelector("[data-rating-card]")).toBeTruthy();
    expect(document.querySelector("[data-hero-layer]")).toBeTruthy();
    expect(document.querySelector("[data-customer-canvas='390 / 844']")).toBeTruthy();
    expect(document.querySelector("[data-card-fixed]")).toBeTruthy();
    expect(screen.getByText("Not on Tags yet")).toBeVisible();
    expect(screen.getByText("Drag to move. Stars stay put.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Add photo" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Publish" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Download blank page" })).toBeVisible();
    expect(screen.queryByLabelText(/business name/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/logo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Looks|template pack/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/location/i)).not.toBeInTheDocument();
  });
});
