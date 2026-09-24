import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
    render(<CustomerPageEditor businessName="Mario’s Pizza" />);

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

    // V1 is upload → preview → Publish. "Save draft" beside "Go live" asked the
    // owner to hold a draft/published model in their head just to decide which
    // button meant "done" — and publish() saves first anyway, so the draft step
    // was always implicit. One action, and no tagline field.
    expect(screen.getByRole("button", { name: /upload photo|replace photo/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /^publish/i })).toBeVisible();
    expect(screen.queryByRole("button", { name: /save draft/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /go live|update live/i })).toBeNull();
    expect(screen.queryByLabelText(/tagline/i)).toBeNull();

    // No location clutter on the customer page.
    expect(screen.queryByText(/location/i)).not.toBeInTheDocument();
  });
});

/**
 * Publish is save-then-publish, and "Page is live!" has to be true.
 *
 * The save result was discarded, so a failed save meant publishing the previous
 * draft and then reporting success — the owner walked away believing the photo
 * they had just chosen was on the counter.
 */
describe("Customer page publish", () => {
  function mockFetch(handlers: {
    load?: () => Response;
    save: () => Response | Promise<Response>;
    publish?: () => Response;
  }) {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push(`${method} ${String(input)}`);
      if (method === "GET") {
        return (
          handlers.load?.() ??
          new Response(JSON.stringify({ data: { draft: {}, published: null } }), { status: 200 })
        );
      }
      if (method === "PUT") return handlers.save();
      return handlers.publish?.() ?? new Response(JSON.stringify({ data: {} }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return calls;
  }

  afterEach(() => vi.unstubAllGlobals());

  async function renderEditor() {
    render(<CustomerPageEditor businessName="Mario’s Pizza" />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^publish/i })).toBeInTheDocument(),
    );
  }

  it("does not publish, or claim success, when the save fails", async () => {
    const calls = mockFetch({
      save: () =>
        new Response(JSON.stringify({ error: { message: "Your session expired." } }), {
          status: 403,
        }),
    });

    await renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /^publish/i }));

    await waitFor(() => expect(screen.getByText(/session expired/i)).toBeVisible());
    expect(screen.queryByText(/page is live/i)).not.toBeInTheDocument();
    // The publish request must never have been sent.
    expect(calls.filter((call) => call.startsWith("POST"))).toHaveLength(0);
  });

  it("explains that nothing was published when the save fails without a message", async () => {
    mockFetch({ save: () => new Response("{}", { status: 500 }) });

    await renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /^publish/i }));

    await waitFor(() => expect(screen.getByText(/nothing was published/i)).toBeVisible());
    expect(screen.queryByText(/page is live/i)).not.toBeInTheDocument();
  });

  it("does not claim success when the network drops mid-publish", async () => {
    mockFetch({
      save: () => {
        throw new TypeError("Failed to fetch");
      },
    });

    await renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /^publish/i }));

    await waitFor(() => expect(screen.getByText(/could not reach reviewboost/i)).toBeVisible());
    expect(screen.queryByText(/page is live/i)).not.toBeInTheDocument();
    // And the button is usable again rather than stuck on "Publishing…".
    expect(screen.getByRole("button", { name: /^publish/i })).toBeEnabled();
  });

  it("publishes, in order, once the save succeeds", async () => {
    const calls = mockFetch({
      save: () => new Response(JSON.stringify({ data: {} }), { status: 200 }),
      publish: () => new Response(JSON.stringify({ data: {} }), { status: 200 }),
    });

    await renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /^publish/i }));

    await waitFor(() => expect(screen.getByText(/page is live/i)).toBeVisible());
    const writes = calls.filter((call) => !call.startsWith("GET"));
    expect(writes[0]).toMatch(/^PUT/);
    expect(writes[1]).toMatch(/^POST/);
  });

  it("reports a publish failure without claiming the page is live", async () => {
    mockFetch({
      save: () => new Response(JSON.stringify({ data: {} }), { status: 200 }),
      publish: () =>
        new Response(JSON.stringify({ error: { message: "Storage is unavailable." } }), {
          status: 503,
        }),
    });

    await renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /^publish/i }));

    await waitFor(() => expect(screen.getByText(/storage is unavailable/i)).toBeVisible());
    expect(screen.queryByText(/page is live/i)).not.toBeInTheDocument();
  });
});

/**
 * The preview is what the customer receives, so Publish must never be
 * pressable while the previewed image has not finished server confirmation.
 * A picked photo appears in the preview instantly (good), but that alone must
 * not unblock Publish until the upload pipeline confirms it — otherwise
 * Publish can go out for a *different*, previously-confirmed asset while the
 * owner is staring at their new, unconfirmed photo.
 */
describe("Customer page hero upload safety", () => {
  function mockUploadFlow(overrides: {
    beginOk?: boolean;
    putOk?: boolean;
    confirmOk?: boolean;
  } = {}) {
    const { beginOk = true, putOk = true, confirmOk = true } = overrides;
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);

      if (method === "GET" && url.includes("/api/v1/customer-page")) {
        return new Response(JSON.stringify({ data: { draft: {}, published: null } }), {
          status: 200,
        });
      }
      if (method === "POST" && url.includes("/assets")) {
        return beginOk
          ? new Response(
              JSON.stringify({ data: { assetId: "asset-1", path: "p/1.jpg", token: "tok" } }),
              { status: 200 },
            )
          : new Response(JSON.stringify({ error: { message: "Could not start upload." } }), {
              status: 500,
            });
      }
      if (method === "PUT" && url.includes("storage")) {
        return putOk
          ? new Response(null, { status: 200 })
          : new Response(null, { status: 500 });
      }
      if (method === "PUT" && url.includes("/assets")) {
        return confirmOk
          ? new Response(JSON.stringify({ data: {} }), { status: 200 })
          : new Response(JSON.stringify({ error: { message: "Could not verify upload." } }), {
              status: 500,
            });
      }
      // customer-page save/publish, unused directly in these tests.
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return calls;
  }

  // jsdom does not implement URL.createObjectURL/revokeObjectURL at all, so
  // there is nothing to spy on — assign them directly rather than replacing
  // the whole URL global (which would drop its constructor/instanceof
  // behavior that fetch internals rely on).
  //
  // These are installed once for the file (not torn down per test) because
  // @testing-library/react's global `afterEach(cleanup)` — registered in
  // tests/setup.ts — runs AFTER this describe block's own afterEach (outer
  // hooks run after inner ones). Deleting the polyfill in a local afterEach
  // would remove it before that cleanup unmounts the component, and the
  // component's unmount effect calls URL.revokeObjectURL.
  beforeAll(() => {
    (URL as unknown as { createObjectURL: (obj: unknown) => string }).createObjectURL = vi.fn(
      () => "blob:local-preview",
    );
    (URL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function renderAndPickPhoto() {
    render(<CustomerPageEditor businessName="Mario’s Pizza" />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^publish/i })).toBeInTheDocument(),
    );
    const file = new File(["x"], "hero.jpg", { type: "image/jpeg" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
  }

  it("shows the selected photo immediately, before the upload finishes", async () => {
    mockUploadFlow();
    await renderAndPickPhoto();

    await waitFor(() =>
      expect(document.querySelector('[data-hero-layer] img')?.getAttribute("src")).toBe(
        "blob:local-preview",
      ),
    );

    // Drain the rest of the (successful) upload chain before the test ends,
    // so no pending promise is left running once fetch gets unstubbed.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^publish/i })).toBeEnabled(),
    );
  });

  it("keeps Publish disabled while the upload is pending", async () => {
    mockUploadFlow();
    await renderAndPickPhoto();

    // Immediately after picking, before any network response resolves.
    expect(screen.getByRole("button", { name: /^publish/i })).toBeDisabled();

    // Drain the rest of the (successful) upload chain before the test ends,
    // so no pending promise is left running once fetch gets unstubbed.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^publish/i })).toBeEnabled(),
    );
  });

  it("keeps Publish disabled after upload confirmation fails", async () => {
    mockUploadFlow({ confirmOk: false });
    await renderAndPickPhoto();

    await waitFor(() => expect(screen.getByText(/upload failed/i)).toBeVisible());
    expect(screen.getByRole("button", { name: /^publish/i })).toBeDisabled();
  });

  it("keeps Publish disabled after the storage upload itself fails", async () => {
    mockUploadFlow({ putOk: false });
    await renderAndPickPhoto();

    await waitFor(() => expect(screen.getByText(/upload failed/i)).toBeVisible());
    expect(screen.getByRole("button", { name: /^publish/i })).toBeDisabled();
  });

  it("enables Publish once the upload is fully confirmed", async () => {
    mockUploadFlow();
    await renderAndPickPhoto();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^publish/i })).toBeEnabled(),
    );
  });

  it("does not let Publish go through for an old asset while a new, unconfirmed image is shown", async () => {
    // A previously published image already exists (heroConfirmed starts true).
    // Picking a replacement must immediately re-block Publish, even though
    // the old confirmed asset would otherwise still be sitting in the draft.
    const calls = mockUploadFlow({ confirmOk: false });
    render(<CustomerPageEditor businessName="Mario’s Pizza" />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^publish/i })).toBeInTheDocument(),
    );
    // Starts enabled: no pending replacement yet.
    expect(screen.getByRole("button", { name: /^publish/i })).toBeEnabled();

    const file = new File(["x"], "hero.jpg", { type: "image/jpeg" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    // Blocked the instant the new (unconfirmed) photo is shown...
    expect(screen.getByRole("button", { name: /^publish/i })).toBeDisabled();
    // ...and stays blocked once confirmation comes back as a failure, so the
    // owner can never press Publish while this unconfirmed image is visible.
    await waitFor(() => expect(screen.getByText(/upload failed/i)).toBeVisible());
    expect(screen.getByRole("button", { name: /^publish/i })).toBeDisabled();
    expect(calls.some((call) => call.startsWith("POST /api/v1/customer-page\""))).toBe(false);
  });
});
