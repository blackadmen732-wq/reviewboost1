import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The Customer Page, from the owner's side.
 *
 * The database enforces the rules — `supabase/tests/customer_page_test.sql`
 * performs every one of them as a real role. What is tested here is the API
 * shape above it: that a draft never leaks into the published field, that the
 * organization and the location are named rather than guessed, and that an
 * upload is confirmed against storage rather than against the caller's word.
 */

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

const rpcCalls: RpcCall[] = [];
let rpcResult: { data: unknown; error: { message: string } | null } = { data: null, error: null };
let profileRow: Record<string, unknown> | null = null;
let assetRow: Record<string, unknown> | null = null;
let storageObjects: Array<{ name: string; metadata: Record<string, unknown> }> = [];
let signedUpload: { data: { token: string } | null; error: unknown } = {
  data: { token: "signed-token" },
  error: null,
};

function queryBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "order", "limit", "lt", "in", "not", "eq", "neq", "is"]) {
    builder[method] = chain;
  }
  builder["maybeSingle"] = () => Promise.resolve({ data: rows[0] ?? null, error: null });
  builder["then"] = (resolve: (v: { data: unknown; error: unknown }) => unknown) =>
    resolve({ data: rows, error: null });
  return builder;
}

function fakeClient() {
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "user-1" } }, error: null }) },
    from: (table: string) => ({
      select: () =>
        queryBuilder(
          table === "customer_page_profiles" && profileRow
            ? [profileRow]
            : table === "customer_page_assets" && assetRow
              ? [assetRow]
              : [],
        ),
      update: () => queryBuilder([]),
      insert: () => queryBuilder([]),
    }),
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(rpcResult);
    },
    storage: {
      from: () => ({
        createSignedUploadUrl: () => Promise.resolve(signedUpload),
        list: () => Promise.resolve({ data: storageObjects, error: null }),
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://assets.test/${path}` },
        }),
      }),
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({ createClient: () => fakeClient() }));

const ORG = "11111111-1111-1111-1111-111111111111";
const LOCATION = "22222222-2222-2222-2222-222222222222";

beforeAll(() => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  process.env.PUBLIC_FRONTEND_URL = "https://app.reviewboost.test";
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
});

beforeEach(() => {
  rpcCalls.length = 0;
  rpcResult = { data: null, error: null };
  profileRow = null;
  assetRow = null;
  storageObjects = [];
  signedUpload = { data: { token: "signed-token" }, error: null };
});

async function context() {
  const { createClient } = await import("@supabase/supabase-js");
  return { db: createClient("", "") as never, userId: "user-1", orgId: ORG, role: "owner" as const };
}

describe("reading the page", () => {
  it("reports an untouched page as an empty draft with nothing published", async () => {
    const { readCustomerPage } = await import("@/lib/server/customer-page-service");
    const page = await readCustomerPage(await context(), ORG, null, "req-1");

    expect(page).toEqual({
      draft: {},
      published: null,
      draftHeroUrl: null,
      publishedVersion: 0,
      publishedAt: null,
    });
  });

  it("keeps the draft and the published snapshot as separate things", async () => {
    profileRow = {
      draft: { templateId: "minimal", tagline: "Being edited" },
      published: { templateId: "bold", tagline: "What customers see" },
      published_version: 3,
      published_at: "2026-09-15T00:00:00Z",
    };
    const { readCustomerPage } = await import("@/lib/server/customer-page-service");
    const page = await readCustomerPage(await context(), ORG, null, "req-2");

    expect(page.draft.tagline).toBe("Being edited");
    expect(page.published?.tagline).toBe("What customers see");
    expect(page.publishedVersion).toBe(3);
  });
});

describe("previewing the draft", () => {
  it("gives the owner the draft's photo, not the one that is live", async () => {
    profileRow = {
      draft: { heroAssetId: "33333333-3333-3333-3333-333333333333" },
      published: { heroAssetId: "44444444-4444-4444-4444-444444444444", heroUrl: "https://assets.test/live.jpg" },
      published_version: 1,
      published_at: "2026-09-15T00:00:00Z",
    };
    assetRow = { public_url: "https://assets.test/draft.jpg" };

    const { readCustomerPage } = await import("@/lib/server/customer-page-service");
    const page = await readCustomerPage(await context(), ORG, null, "req-draft");

    expect(page.draftHeroUrl).toBe("https://assets.test/draft.jpg");
    expect(page.published?.heroUrl).toBe("https://assets.test/live.jpg");
  });

  it("has no draft photo when the upload never finished", async () => {
    profileRow = {
      draft: { heroAssetId: "33333333-3333-3333-3333-333333333333" },
      published: null,
      published_version: 0,
      published_at: null,
    };

    const { readCustomerPage } = await import("@/lib/server/customer-page-service");
    const page = await readCustomerPage(await context(), ORG, null, "req-draft-2");

    expect(page.draftHeroUrl).toBeNull();
  });
});

describe("writing the page", () => {
  it("names the organization and the location rather than guessing them", async () => {
    const { saveCustomerPageDraft } = await import("@/lib/server/customer-page-service");
    await saveCustomerPageDraft(
      await context(),
      ORG,
      LOCATION,
      { templateId: "bold", tagline: "Hello" },
      "req-3",
    );

    expect(rpcCalls[0]?.args).toEqual({
      p_org_id: ORG,
      p_location_id: LOCATION,
      p_draft: { templateId: "bold", tagline: "Hello" },
    });
  });

  it("edits the organization's page when no location is named", async () => {
    const { saveCustomerPageDraft } = await import("@/lib/server/customer-page-service");
    await saveCustomerPageDraft(await context(), ORG, null, { templateId: "classic" }, "req-4");

    expect(rpcCalls[0]?.args["p_location_id"]).toBeNull();
  });

  it("explains an unfinished upload instead of returning a 503", async () => {
    rpcResult = { data: null, error: { message: "asset_not_ready" } };
    const { publishCustomerPage } = await import("@/lib/server/customer-page-service");

    await expect(publishCustomerPage(await context(), ORG, null, "req-5")).rejects.toThrow(
      /still uploading/,
    );
  });

  it("refuses a page the caller may not change", async () => {
    rpcResult = { data: null, error: { message: "not_found_or_forbidden" } };
    const { saveCustomerPageDraft } = await import("@/lib/server/customer-page-service");

    await expect(
      saveCustomerPageDraft(await context(), ORG, null, { templateId: "bold" }, "req-6"),
    ).rejects.toThrow(/cannot change this page/);
  });

  it("preserves all draft fields when only tagline changes", async () => {
    // An owner with an existing draft containing template + logo + hero edits
    // only the tagline. The full merged draft must reach the RPC so the RPC
    // replace does not drop the other fields.
    const { saveCustomerPageDraft } = await import("@/lib/server/customer-page-service");
    const fullDraft = {
      templateId: "bold" as const,
      tagline: "Old tagline",
      logoAssetId: "33333333-3333-3333-3333-333333333333",
      heroAssetId: "44444444-4444-4444-4444-444444444444",
    };

    // Simulate what the editor does: load full draft, change tagline, save all.
    await saveCustomerPageDraft(
      await context(),
      ORG,
      null,
      { ...fullDraft, tagline: "New tagline" },
      "req-preserve-1",
    );

    const call = rpcCalls.find(({ name }) => name === "rpc_customer_page_save_draft");
    const saved = call?.args["p_draft"] as Record<string, unknown>;
    expect(saved["templateId"]).toBe("bold");
    expect(saved["tagline"]).toBe("New tagline");
    expect(saved["logoAssetId"]).toBe("33333333-3333-3333-3333-333333333333");
    expect(saved["heroAssetId"]).toBe("44444444-4444-4444-4444-444444444444");
  });

  it("preserves all draft fields when saving without any change", async () => {
    const { saveCustomerPageDraft } = await import("@/lib/server/customer-page-service");
    const existingDraft = {
      templateId: "minimal" as const,
      tagline: "Unchanged",
      heroAssetId: "55555555-5555-5555-5555-555555555555",
    };

    // Owner reloads editor and immediately saves — draft must be unchanged.
    await saveCustomerPageDraft(await context(), ORG, null, { ...existingDraft }, "req-preserve-2");

    const call = rpcCalls.find(({ name }) => name === "rpc_customer_page_save_draft");
    const saved = call?.args["p_draft"] as Record<string, unknown>;
    expect(saved["templateId"]).toBe("minimal");
    expect(saved["tagline"]).toBe("Unchanged");
    expect(saved["heroAssetId"]).toBe("55555555-5555-5555-5555-555555555555");
  });
});

describe("uploads", () => {
  it("builds the path from the organization, not from anything the caller sends", async () => {
    rpcResult = { data: "asset-1", error: null };
    const { beginAssetUpload } = await import("@/lib/server/customer-page-service");

    const ticket = await beginAssetUpload(await context(), ORG, "hero", "image/png", "req-7");

    expect(ticket.path.startsWith(`org/${ORG}/hero/`)).toBe(true);
    expect(ticket.path.endsWith(".png")).toBe(true);
    expect(ticket.token).toBe("signed-token");
  });

  it("refuses to confirm an object that is not in storage", async () => {
    storageObjects = [];
    const { confirmAssetUpload } = await import("@/lib/server/customer-page-service");

    await expect(
      confirmAssetUpload(await context(), ORG, "asset-1", `org/${ORG}/hero/a.png`, "req-8"),
    ).rejects.toThrow(/did not finish uploading/);
    expect(rpcCalls.some(({ name }) => name === "rpc_customer_page_asset_confirm")).toBe(false);
  });

  it("refuses an object that is too large", async () => {
    storageObjects = [{ name: "a.png", metadata: { size: 6 * 1024 * 1024, mimetype: "image/png" } }];
    const { confirmAssetUpload } = await import("@/lib/server/customer-page-service");

    await expect(
      confirmAssetUpload(await context(), ORG, "asset-1", `org/${ORG}/hero/a.png`, "req-9"),
    ).rejects.toThrow(/under 5 MB/);
  });

  it("refuses an object that is not an image, whatever it was announced as", async () => {
    storageObjects = [
      { name: "a.png", metadata: { size: 1024, mimetype: "text/html" } },
    ];
    const { confirmAssetUpload } = await import("@/lib/server/customer-page-service");

    await expect(
      confirmAssetUpload(await context(), ORG, "asset-1", `org/${ORG}/hero/a.png`, "req-10"),
    ).rejects.toThrow(/PNG, JPEG, or WebP/);
    expect(rpcCalls.some(({ name }) => name === "rpc_customer_page_asset_confirm")).toBe(false);
  });

  it("confirms a real image and records what storage actually reported", async () => {
    storageObjects = [{ name: "a.png", metadata: { size: 2048, mimetype: "image/png" } }];
    const { confirmAssetUpload } = await import("@/lib/server/customer-page-service");

    const confirmed = await confirmAssetUpload(
      await context(),
      ORG,
      "asset-1",
      `org/${ORG}/hero/a.png`,
      "req-11",
    );

    expect(confirmed.byteSize).toBe(2048);
    const call = rpcCalls.find(({ name }) => name === "rpc_customer_page_asset_confirm");
    expect(call?.args["p_byte_size"]).toBe(2048);
    expect(call?.args["p_org_id"]).toBe(ORG);
  });
});
