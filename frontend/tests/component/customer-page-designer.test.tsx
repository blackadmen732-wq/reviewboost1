import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerPageDesigner } from "@/features/customer-page-designer/customer-page-designer";
import {
  emptyDesignRecord,
  type CustomerPageDesignRecord,
  type CustomerPageDesignStore,
  type DesignScope,
} from "@/lib/customer-page/design-store";
import {
  designsAreEqual,
  emptyCustomerPageDesign,
  type CustomerPageDesign,
} from "@/lib/customer-page/design";
import { renderWithProviders } from "@/tests/helpers/render";

/**
 * The designer's job is to make one distinction impossible to get wrong: what
 * the owner is looking at versus what their customers are getting. Most of what
 * is checked here is that distinction surviving edits, scope changes, and
 * publishing.
 */

const photo = "data:image/png;base64,iVBORw0KGgo=";

/** The store the real component talks to, kept in memory and observable. */
function fakeStore() {
  const records = new Map<string, CustomerPageDesignRecord>();
  const listeners = new Set<() => void>();
  const calls: string[] = [];

  const key = (scope: DesignScope) => `${scope.orgId}:${scope.locationId ?? "all"}`;

  const store: CustomerPageDesignStore = {
    read: (scope) => records.get(key(scope)) ?? emptyDesignRecord,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    saveDraft: (scope, design) => {
      calls.push("saveDraft");
      const current = records.get(key(scope)) ?? emptyDesignRecord;
      records.set(key(scope), { ...current, draft: design });
    },
    discardDraft: (scope) => {
      const current = records.get(key(scope)) ?? emptyDesignRecord;
      records.set(key(scope), { ...current, draft: null });
    },
    publish: (scope, design) => {
      calls.push("publish");
      const record: CustomerPageDesignRecord = {
        published: design,
        draft: null,
        publishedAt: "2026-01-01T00:00:00.000Z",
      };
      records.set(key(scope), record);
      return record;
    },
  };

  return {
    store,
    calls,
    seed(scope: DesignScope, record: CustomerPageDesignRecord) {
      records.set(key(scope), record);
    },
    /** An edit from another tab, which is the only thing the store announces. */
    announce(scope: DesignScope, record: CustomerPageDesignRecord) {
      records.set(key(scope), record);
      for (const listener of listeners) listener();
    },
  };
}

function design(overrides: Partial<CustomerPageDesign> = {}): CustomerPageDesign {
  return { ...emptyCustomerPageDesign, ...overrides };
}

function renderDesigner(
  options: Partial<Parameters<typeof CustomerPageDesigner>[0]> = {},
) {
  const harness = fakeStore();
  const user = userEvent.setup();
  renderWithProviders(
    <CustomerPageDesigner
      orgId="org-1"
      businessName="Mario’s Pizza"
      locations={[{ locationId: "loc-1", name: "Downtown" }]}
      languages={["en", "es", "ht"]}
      canEdit
      store={harness.store}
      {...options}
    />,
  );
  return { user, ...harness };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("customer page designer — what the owner sees", () => {
  it("shows a finished page with the real business name before anything is added", () => {
    renderDesigner();

    // Not an empty state: the preview is already a page, and the one missing
    // thing is the one thing asked for.
    expect(screen.getByText("Make it feel like your business.")).toBeVisible();
    expect(screen.getByRole("button", { name: /add photo/i })).toBeEnabled();
    expect(document.querySelector(".cp-wordmark")).toHaveTextContent("Mario’s");
  });

  it("previews with the production page, not an imitation of it", () => {
    renderDesigner();

    // The same components, so the preview cannot drift from what is scanned.
    expect(document.querySelector(".cp-sheet")).toBeInTheDocument();
    expect(document.querySelector(".cp-hero")).toBeInTheDocument();
    expect(
      within(document.querySelector(".cp-sheet") as HTMLElement).getByRole("heading"),
    ).toHaveTextContent("How was your visit?");
  });

  it("offers no way to record a rating from the preview", async () => {
    const { user } = renderDesigner();

    const stars = within(document.querySelector(".cp-sheet") as HTMLElement);
    await user.click(stars.getByRole("radio", { name: "4 stars" }));

    // Fills, so the design can be judged. Saves nothing, because the container
    // that owns saving is not in this tree at all.
    expect(stars.getByRole("radio", { name: "4 stars" })).toBeChecked();
    expect(document.querySelectorAll("[data-filled]")).toHaveLength(4);
  });

  it("keeps the rating sheet out of the owner's hands", () => {
    renderDesigner();

    // Every control on this screen belongs to the hero. Nothing offers a way to
    // restyle the half of the page that customers recognise.
    const controls = screen.getAllByRole("button").map((button) => button.textContent);
    expect(controls.join(" ")).not.toMatch(/sheet|stars|question|rating/i);
  });
});

describe("customer page designer — published versus not", () => {
  it("says nothing is published until something is, then says so", async () => {
    const { user, store } = renderDesigner();

    expect(screen.queryByText("Published")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /modern/i }));
    expect(screen.getByText("Changes not published")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Publish" }));

    expect(await screen.findByText("Published")).toBeVisible();
    expect(screen.queryByText("Changes not published")).not.toBeInTheDocument();
    expect(store.read({ orgId: "org-1", locationId: null }).published?.look).toBe(
      "modern",
    );
  });

  it("changes nothing a customer can see until Publish", async () => {
    const harness = fakeStore();
    harness.seed(
      { orgId: "org-1", locationId: null },
      { published: design({ look: "classic" }), draft: null, publishedAt: "x" },
    );

    const { user } = renderDesigner({ store: harness.store });
    await user.click(screen.getByRole("radio", { name: /bold/i }));

    expect(screen.getByRole("radio", { name: /bold/i })).toBeChecked();
    await waitFor(() => expect(harness.calls).toContain("saveDraft"));

    // The draft moved. What a customer gets did not.
    const record = harness.store.read({ orgId: "org-1", locationId: null });
    expect(record.draft?.look).toBe("bold");
    expect(record.published?.look).toBe("classic");
  });

  it("cannot publish when there is nothing to publish", async () => {
    const { user } = renderDesigner();

    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: /editorial/i }));
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
  });

  it("retires the published confirmation as soon as the next edit lands", async () => {
    const { user } = renderDesigner();

    await user.click(screen.getByRole("radio", { name: /bold/i }));
    await user.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByText("Published")).toBeVisible();

    await user.click(screen.getByRole("radio", { name: /minimal/i }));
    expect(screen.getByText("Changes not published")).toBeVisible();
  });

  it("does not write a draft just because the designer unmounted", () => {
    const harness = fakeStore();
    harness.seed(
      { orgId: "org-1", locationId: null },
      { published: design({ look: "classic", heroImage: photo }), draft: null, publishedAt: "x" },
    );

    const { unmount } = renderWithProviders(
      <CustomerPageDesigner
        orgId="org-1"
        businessName="Mario’s Pizza"
        locations={[{ locationId: "loc-1", name: "Downtown" }]}
        languages={["en"]}
        canEdit
        store={harness.store}
      />,
    );

    unmount();

    expect(harness.calls).not.toContain("saveDraft");
    const record = harness.store.read({ orgId: "org-1", locationId: null });
    expect(record.draft).toBeNull();
    expect(record.published?.look).toBe("classic");
  });

  it("saves the draft without publishing it", async () => {
    const { user, store, calls } = renderDesigner();

    await user.click(screen.getByRole("radio", { name: /modern/i }));

    await waitFor(() => expect(calls).toContain("saveDraft"));
    const record = store.read({ orgId: "org-1", locationId: null });
    expect(record.draft?.look).toBe("modern");
    expect(record.published).toBeNull();
    expect(calls).not.toContain("publish");
  });
});

describe("customer page designer — scope and permissions", () => {
  it("never mentions locations to a business with one", () => {
    renderDesigner();

    expect(screen.queryByLabelText("Editing")).not.toBeInTheDocument();
  });

  it("edits one location without touching the others", async () => {
    const { user, store } = renderDesigner({
      locations: [
        { locationId: "loc-1", name: "Downtown" },
        { locationId: "loc-2", name: "Airport" },
      ],
    });

    await user.click(screen.getByRole("radio", { name: /bold/i }));
    await user.click(screen.getByRole("button", { name: "Publish" }));

    await user.selectOptions(screen.getByLabelText("Editing"), "loc-2");
    expect(
      screen.getByText(/this location only/i),
    ).toBeVisible();

    // The location starts from nothing of its own rather than inheriting an
    // edit it was never given.
    expect(store.read({ orgId: "org-1", locationId: "loc-2" }).published).toBeNull();
    expect(store.read({ orgId: "org-1", locationId: null }).published?.look).toBe(
      "bold",
    );
  });

  it("lets a viewer look without offering them anything to change", () => {
    renderDesigner({ canEdit: false });

    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add photo/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /bold/i })).toBeDisabled();
    expect(screen.getByText(/can see this page but not change it/i)).toBeVisible();
  });
});

describe("customer page designer — a design changed somewhere else", () => {
  it("adopts an edit made in another tab", async () => {
    const harness = renderDesigner();

    harness.announce(
      { orgId: "org-1", locationId: null },
      {
        published: design({ look: "editorial", heroImage: photo }),
        draft: null,
        publishedAt: "x",
      },
    );

    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /editorial/i })).toBeChecked(),
    );
    expect(screen.getByText("Published")).toBeVisible();
  });

  it("treats a design equal to the published one as nothing to publish", async () => {
    const harness = fakeStore();
    const published = design({ look: "classic" });
    harness.seed(
      { orgId: "org-1", locationId: null },
      { published, draft: null, publishedAt: "x" },
    );

    renderWithProviders(
      <CustomerPageDesigner
        orgId="org-1"
        businessName="Mario’s Pizza"
        locations={[{ locationId: "loc-1", name: "Downtown" }]}
        languages={["en"]}
        canEdit
        store={harness.store}
      />,
    );

    expect(screen.getByText("Published")).toBeVisible();
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(
      designsAreEqual(harness.store.read({ orgId: "org-1", locationId: null }).published!, published),
    ).toBe(true);
  });
});
