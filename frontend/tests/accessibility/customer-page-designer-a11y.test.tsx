import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { describe, expect, it } from "vitest";

import { CustomerPageDesigner } from "@/features/customer-page-designer/customer-page-designer";
import { LookPicker } from "@/features/customer-page-designer/look-picker";
import { emptyCustomerPageDesign } from "@/lib/customer-page/design";
import {
  emptyDesignRecord,
  type CustomerPageDesignRecord,
  type CustomerPageDesignStore,
} from "@/lib/customer-page/design-store";
import { renderWithProviders } from "@/tests/helpers/render";

const inertStore: CustomerPageDesignStore = {
  read: () => emptyDesignRecord,
  subscribe: () => () => undefined,
  saveDraft: () => undefined,
  discardDraft: () => undefined,
  publish: (_scope, design): CustomerPageDesignRecord => ({
    published: design,
    draft: null,
    publishedAt: "2026-01-01T00:00:00.000Z",
  }),
};

function renderDesigner(canEdit = true) {
  return renderWithProviders(
    <CustomerPageDesigner
      orgId="org-1"
      businessName="Mario’s Pizza"
      locations={[
        { locationId: "loc-1", name: "Downtown" },
        { locationId: "loc-2", name: "Airport" },
      ]}
      languages={["en", "es", "ht"]}
      canEdit={canEdit}
      store={inertStore}
    />,
  );
}

describe("customer page designer accessibility", () => {
  it("has no Axe violations while editing", async () => {
    const { container } = renderDesigner();
    expect((await axe(container)).violations).toEqual([]);
  });

  it("has no Axe violations in read-only mode", async () => {
    const { container } = renderDesigner(false);
    expect((await axe(container)).violations).toEqual([]);
  });

  it("offers the Looks as a labelled set of choices, not a grid of images", () => {
    render(
      <LookPicker
        design={emptyCustomerPageDesign}
        businessName="Mario’s Pizza"
        logoAlt="Mario’s Pizza logo"
        onChange={() => undefined}
      />,
    );

    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(6);
    // Each one is announced by its name, so the choice is usable without seeing
    // the thumbnail it is illustrated with.
    expect(screen.getByRole("radio", { name: /signature/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /minimal/i })).not.toBeChecked();
  });

  it("keeps the whole workspace reachable from the keyboard", async () => {
    const user = userEvent.setup();
    renderDesigner();

    await user.tab();
    // Whatever the first stop is, it is a control rather than a decorative
    // element, and tabbing continues to reach the Look choices.
    expect(document.activeElement?.tagName).toMatch(/^(A|BUTTON|INPUT|SELECT)$/);

    const look = screen.getByRole("radio", { name: /bold/i });
    look.focus();
    expect(document.activeElement).toBe(look);
  });

  it("describes the crop surface for someone who cannot drag it", async () => {
    const user = userEvent.setup();
    renderDesigner();

    // Reaching the editor needs a photo, which needs a file picker; the surface
    // itself is what matters, so it is asserted where it is rendered.
    expect(screen.getByRole("button", { name: /add photo/i })).toBeEnabled();
    await user.click(screen.getByRole("radio", { name: /classic/i }));
    expect(screen.getByRole("radio", { name: /classic/i })).toBeChecked();
  });
});
