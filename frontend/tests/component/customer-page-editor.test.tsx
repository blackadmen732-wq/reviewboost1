import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
  }),
}));

import { CustomerPageEditor } from "@/features/customer-page/customer-page-editor";
import { customerMessages } from "@/lib/i18n/customer-messages";

/**
 * The owner preview is the customer page, not a drawing of it.
 *
 * These assertions are on the shared presentation tree — the same markers
 * /q/{token} renders — so a future preview that quietly diverges from the live
 * page fails here rather than in front of a customer.
 */
describe("Customer page editor", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ data: { draft: {}, published: null } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("previews the live customer view inside the phone, not a sketch", async () => {
    render(<CustomerPageEditor businessName="Mario’s Pizza" isPublished={false} />);

    await waitFor(() =>
      expect(screen.getByText(customerMessages.en.ratingHeading)).toBeVisible(),
    );

    // The Mario composition: hero layer, fixed rating card, 390/844 canvas.
    expect(document.querySelector("[data-customer-visit]")).toBeTruthy();
    expect(document.querySelector("[data-hero-layer]")).toBeTruthy();
    expect(document.querySelector("[data-rating-card]")).toBeTruthy();
    expect(document.querySelector("[data-customer-canvas='390 / 844']")).toBeTruthy();
    expect(document.querySelector("[data-card-fixed]")).toBeTruthy();
    expect(screen.getByText(customerMessages.en.footerPromise)).toBeVisible();

    // Five stars, and none of them ratable from the owner's chair.
    const stars = screen.getAllByRole("radio");
    expect(stars).toHaveLength(5);
    for (const star of stars) expect(star).toBeDisabled();

    // The owner's controls reach main's draft/publish contract.
    expect(screen.getByRole("button", { name: /add photo/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /save draft/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /go live/i })).toBeVisible();

    // No location clutter on the customer page.
    expect(screen.queryByText(/location/i)).not.toBeInTheDocument();
  });
});
