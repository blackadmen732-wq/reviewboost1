import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    render(<CustomerPageEditor businessName="Mario’s Pizza" isPublished={false} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /go live/i })).toBeInTheDocument(),
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
    fireEvent.click(screen.getByRole("button", { name: /go live/i }));

    await waitFor(() => expect(screen.getByText(/session expired/i)).toBeVisible());
    expect(screen.queryByText(/page is live/i)).not.toBeInTheDocument();
    // The publish request must never have been sent.
    expect(calls.filter((call) => call.startsWith("POST"))).toHaveLength(0);
  });

  it("explains that nothing was published when the save fails without a message", async () => {
    mockFetch({ save: () => new Response("{}", { status: 500 }) });

    await renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /go live/i }));

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
    fireEvent.click(screen.getByRole("button", { name: /go live/i }));

    await waitFor(() => expect(screen.getByText(/could not reach reviewboost/i)).toBeVisible());
    expect(screen.queryByText(/page is live/i)).not.toBeInTheDocument();
    // And the button is usable again rather than stuck on "Publishing…".
    expect(screen.getByRole("button", { name: /go live/i })).toBeEnabled();
  });

  it("publishes, in order, once the save succeeds", async () => {
    const calls = mockFetch({
      save: () => new Response(JSON.stringify({ data: {} }), { status: 200 }),
      publish: () => new Response(JSON.stringify({ data: {} }), { status: 200 }),
    });

    await renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /go live/i }));

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
    fireEvent.click(screen.getByRole("button", { name: /go live/i }));

    await waitFor(() => expect(screen.getByText(/storage is unavailable/i)).toBeVisible());
    expect(screen.queryByText(/page is live/i)).not.toBeInTheDocument();
  });
});
