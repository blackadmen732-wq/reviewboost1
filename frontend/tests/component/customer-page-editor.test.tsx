import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({
    // Signed in: the editor calls the owner API with this session as a Bearer.
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "owner-token" } },
      }),
    },
  }),
}));

// jsdom cannot decode images, so photo preparation is stood in for here; its
// own behaviour is covered by tests/unit/normalize-photo.test.ts and by a real
// browser. By default a picked file comes back prepared as itself.
const normalizePhoto = vi.hoisted(() =>
  vi.fn(async (file: File) => ({
    blob: file,
    type: "image/jpeg" as const,
    width: 1200,
    height: 900,
    converted: false,
  })),
);
vi.mock("@/lib/images/normalize-photo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/images/normalize-photo")>()),
  normalizePhoto,
}));

import { CustomerPageEditor } from "@/features/customer-page/customer-page-editor";
import { NormalizePhotoError } from "@/lib/images/normalize-photo";
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
      vi.fn(
        async () =>
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
    expect(
      document.querySelector("[data-customer-canvas='390 / 844']"),
    ).toBeTruthy();
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
    expect(
      screen.getByRole("button", { name: /add photo|replace photo/i }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /^publish/i })).toBeVisible();
    expect(screen.queryByRole("button", { name: /save draft/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /go live|update live/i }),
    ).toBeNull();
    expect(screen.queryByLabelText(/tagline/i)).toBeNull();

    // No location clutter on the customer page.
    expect(screen.queryByText(/location/i)).not.toBeInTheDocument();
  });
});

/**
 * Publish is save-then-publish, and "Customer page published" has to be true.
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
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push(`${method} ${String(input)}`);
        if (method === "GET") {
          return (
            handlers.load?.() ??
            new Response(
              JSON.stringify({ data: { draft: {}, published: null } }),
              { status: 200 },
            )
          );
        }
        if (method === "PUT") return handlers.save();
        return (
          handlers.publish?.() ??
          new Response(JSON.stringify({ data: {} }), { status: 200 })
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    return calls;
  }

  afterEach(() => vi.unstubAllGlobals());

  async function renderEditor() {
    render(<CustomerPageEditor businessName="Mario’s Pizza" />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^publish/i }),
      ).toBeInTheDocument(),
    );
  }

  it("does not publish, or claim success, when the save fails", async () => {
    const calls = mockFetch({
      save: () =>
        new Response(
          JSON.stringify({ error: { message: "Your session expired." } }),
          {
            status: 403,
          },
        ),
    });

    await renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /^publish/i }));

    await waitFor(() =>
      expect(screen.getByText(/session expired/i)).toBeVisible(),
    );
    expect(
      screen.queryByText(/customer page published/i),
    ).not.toBeInTheDocument();
    // The publish request must never have been sent.
    expect(calls.filter((call) => call.startsWith("POST"))).toHaveLength(0);
  });

  it("explains that nothing was published when the save fails without a message", async () => {
    mockFetch({ save: () => new Response("{}", { status: 500 }) });

    await renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /^publish/i }));

    await waitFor(() =>
      expect(screen.getByText(/nothing was published/i)).toBeVisible(),
    );
    expect(
      screen.queryByText(/customer page published/i),
    ).not.toBeInTheDocument();
  });

  it("does not claim success when the network drops mid-publish", async () => {
    mockFetch({
      save: () => {
        throw new TypeError("Failed to fetch");
      },
    });

    await renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /^publish/i }));

    await waitFor(() =>
      expect(screen.getByText(/could not reach reviewboost/i)).toBeVisible(),
    );
    expect(
      screen.queryByText(/customer page published/i),
    ).not.toBeInTheDocument();
    // And the button is usable again rather than stuck on "Publishing…".
    expect(screen.getByRole("button", { name: /^publish/i })).toBeEnabled();
  });

  it("publishes, in order, once the save succeeds", async () => {
    const calls = mockFetch({
      save: () => new Response(JSON.stringify({ data: {} }), { status: 200 }),
      publish: () =>
        new Response(JSON.stringify({ data: {} }), { status: 200 }),
    });

    await renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /^publish/i }));

    await waitFor(() =>
      expect(screen.getByText(/customer page published/i)).toBeVisible(),
    );
    const writes = calls.filter((call) => !call.startsWith("GET"));
    expect(writes[0]).toMatch(/^PUT/);
    expect(writes[1]).toMatch(/^POST/);
  });

  it("reports a publish failure without claiming the customer page published", async () => {
    mockFetch({
      save: () => new Response(JSON.stringify({ data: {} }), { status: 200 }),
      publish: () =>
        new Response(
          JSON.stringify({ error: { message: "Storage is unavailable." } }),
          {
            status: 503,
          },
        ),
    });

    await renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /^publish/i }));

    await waitFor(() =>
      expect(screen.getByText(/storage is unavailable/i)).toBeVisible(),
    );
    expect(
      screen.queryByText(/customer page published/i),
    ).not.toBeInTheDocument();
  });
});

/**
 * The owner API accepts a Bearer session token and nothing else. The editor
 * used to call it with a bare fetch, so against the real backend it loaded no
 * draft, failed every upload and never published — while these tests, which
 * stub fetch, passed.
 */
describe("Customer page editor, as the signed-in owner", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the owner's session on every owner API call", async () => {
    const auth: Array<string | null> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        auth.push(new Headers(init?.headers).get("authorization"));
        return new Response(
          JSON.stringify({ data: { draft: {}, published: null } }),
          {
            status: 200,
          },
        );
      }),
    );

    render(<CustomerPageEditor businessName="Mario’s Pizza" />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^publish/i })).toBeVisible(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^publish/i }));
    await waitFor(() => expect(auth.length).toBeGreaterThanOrEqual(3));

    expect(auth.every((value) => value === "Bearer owner-token")).toBe(true);
  });

  it("previews a picked photo at once, and puts the old one back if the upload fails", async () => {
    let releaseSign: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/assets") && init?.method === "POST") {
          return new Promise<Response>((resolve) => {
            releaseSign = resolve;
          });
        }
        return new Response(
          JSON.stringify({ data: { draft: {}, published: null } }),
          {
            status: 200,
          },
        );
      }),
    );
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: () => "blob:picked-photo",
        revokeObjectURL: () => undefined,
      }),
    );

    render(<CustomerPageEditor businessName="Mario’s Pizza" />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^publish/i })).toBeVisible(),
    );

    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(["x"], "hero.jpg", { type: "image/jpeg" });
    fireEvent.change(input!, { target: { files: [file] } });

    // Shown while the upload is still in flight.
    await waitFor(() =>
      expect(
        document.querySelector("[data-hero-layer] img")?.getAttribute("src"),
      ).toBe("blob:picked-photo"),
    );

    releaseSign(
      new Response(
        JSON.stringify({
          error: { message: "That file type is not allowed." },
        }),
        {
          status: 400,
        },
      ),
    );

    await waitFor(() =>
      expect(screen.getByText(/file type is not allowed/i)).toBeVisible(),
    );
    expect(document.querySelector("[data-hero-layer] img")).toBeNull();
  });

  it("says why a photo cannot be used, and sends nothing", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${String(input)}`);
        return new Response(
          JSON.stringify({ data: { draft: {}, published: null } }),
          {
            status: 200,
          },
        );
      }),
    );
    normalizePhoto.mockRejectedValueOnce(
      new NormalizePhotoError(
        "heic-unsupported",
        "This browser can’t open HEIC photos.",
      ),
    );

    render(<CustomerPageEditor businessName="Mario’s Pizza" />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^publish/i })).toBeVisible(),
    );

    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input!, {
      target: {
        files: [new File(["x"], "IMG_0001.HEIC", { type: "image/heic" })],
      },
    });

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/can’t open HEIC/),
    );
    expect(calls.some((call) => call.includes("/assets"))).toBe(false);
    expect(document.querySelector("[data-hero-layer] img")).toBeNull();
  });
});

// An unreadable page is not an empty draft. Publishing either would overwrite
// the business's existing page without the owner seeing it first.
describe("Customer page recovery and publication state", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("blocks editing on a failed load and loads the existing page on retry", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              draft: { heroAssetId: "existing-photo" },
              published: {
                heroAssetId: "existing-photo",
                heroUrl: "https://example.test/existing.jpg",
              },
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    render(<CustomerPageEditor businessName="Mario’s Pizza" />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: /^publish/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /add photo|replace photo/i }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Published" })).toBeDisabled(),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(document.querySelector("[data-hero-layer] img")).toHaveAttribute(
      "src",
      "https://example.test/existing.jpg",
    );
  });

  it("clears a published confirmation when another photo finishes uploading", async () => {
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: () => "blob:new-photo",
        revokeObjectURL: vi.fn(),
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input),
          method = init?.method ?? "GET";
        if (method === "GET")
          return new Response(
            JSON.stringify({
              data: {
                draft: { heroAssetId: "old-photo" },
                published: {
                  heroAssetId: "old-photo",
                  heroUrl: "https://example.test/old.jpg",
                },
              },
            }),
            { status: 200 },
          );
        if (path.endsWith("/assets") && method === "POST")
          return new Response(
            JSON.stringify({
              data: {
                assetId: "new-photo",
                path: "new.jpg",
                token: "local-upload",
              },
            }),
            { status: 200 },
          );
        if (path.endsWith("/assets") && method === "PUT")
          return new Response(
            JSON.stringify({
              data: { publicUrl: "https://example.test/new.jpg" },
            }),
            { status: 200 },
          );
        return new Response(JSON.stringify({ data: {} }), { status: 200 });
      }),
    );
    render(<CustomerPageEditor businessName="Mario’s Pizza" />);
    await screen.findByText("Customer page published");
    expect(screen.getByRole("button", { name: "Published" })).toBeDisabled();
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, {
      target: {
        files: [new File(["photo"], "new.jpg", { type: "image/jpeg" })],
      },
    });
    await waitFor(() =>
      expect(document.querySelector("[data-hero-layer] img")).toHaveAttribute(
        "src",
        "https://example.test/new.jpg",
      ),
    );
    expect(screen.queryByText("Customer page published")).toBeNull();
    expect(screen.getByText("Preview · not published yet")).toBeVisible();
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
  });
});
