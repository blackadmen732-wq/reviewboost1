import type { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Customer Page V2 backend contract tests.
 *
 * Tests the feature-flag gating, owner API routing and validation, public
 * context extension (customerPage field), and security invariants. Supabase
 * is mocked — these prove the layer above the database: routing, validation,
 * status codes, secrecy guarantees, and the feature-flag boundary.
 */

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

const calls: RpcCall[] = [];
let rpcHandler: (fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown };

const mockAuthenticatedDb = {
  rpc: (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return Promise.resolve(rpcHandler(fn, args));
  },
};

vi.mock("@/lib/server/supabase", () => ({
  serviceRoleClient: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve(rpcHandler(fn, args));
    },
  }),
}));

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const LOCATION_ID = "22222222-2222-2222-2222-222222222222";
const STAND_ID = "33333333-3333-3333-3333-333333333333";
const PROFILE_ID = "44444444-4444-4444-4444-444444444444";
const ASSET_ID = "55555555-5555-5555-5555-555555555555";
const TOKEN = "abcdefghijklmnop";

const ACTIVE_STAND = {
  org_id: ORG_ID,
  location_id: LOCATION_ID,
  stand_id: STAND_ID,
  business_name: "The Corner Cafe",
  location_name: "High Street",
  google_review_url: "https://g.page/r/CdSAMPLE/review",
  default_locale: "en",
  matched_key_version: 1,
};

vi.mock("@/lib/server/auth", () => ({
  requireOrganizationContext: () =>
    Promise.resolve({
      userId: "user-owner-1",
      orgId: ORG_ID,
      role: "owner",
      db: mockAuthenticatedDb,
    }),
  requireUser: () => Promise.resolve({ userId: "user-owner-1" }),
  requireMembership: () => Promise.resolve({ orgId: ORG_ID, role: "owner" }),
}));

function allowed() {
  return { data: [{ allowed: true, retry_after_seconds: 1 }], error: null };
}

function happyPath(fn: string): { data: unknown; error: unknown } {
  if (fn === "rpc_consume_rate_limit") return allowed();
  if (fn === "rpc_public_resolve_stand") return { data: [ACTIVE_STAND], error: null };
  if (fn === "rpc_customer_page_get") {
    return {
      data: [profileRow()],
      error: null,
    };
  }
  if (fn === "rpc_customer_page_patch_draft") {
    return { data: [{ id: PROFILE_ID }], error: null };
  }
  if (fn === "rpc_customer_page_publish") {
    return { data: [{ id: PROFILE_ID }], error: null };
  }
  if (fn === "rpc_customer_page_create_asset_upload") {
    return { data: [ASSET_ID], error: null };
  }
  if (fn === "rpc_customer_page_resolve_public") {
    return {
      data: [publicResolverRow()],
      error: null,
    };
  }
  return { data: [{ outcome: "created", response_status: null, response_body_encrypted: null }], error: null };
}

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE_ID,
    scope: "organization",
    location_id: null,
    composer_version: 1,
    draft: { templateId: "modern" },
    draft_updated_at: "2026-09-07T00:00:00Z",
    published: { templateId: "modern" },
    published_version: 1,
    published_at: "2026-09-07T00:00:00Z",
    ...overrides,
  };
}

function publicResolverRow() {
  return {
    scope: "organization",
    published: { templateId: "modern", hero: { focalX: 0.5, focalY: 0.5, zoom: 1 } },
    published_version: 1,
    hero_variants: [
      { width: 800, height: 600, path: "customer-page/public/ab/hero-800.webp", contentType: "image/webp", bytes: 50000 },
    ],
    hero_width: 1600,
    hero_height: 1200,
    logo_variants: [
      { width: 200, height: 200, path: "customer-page/public/cd/logo-200.webp", contentType: "image/webp", bytes: 10000 },
    ],
  };
}

function request(
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): NextRequest {
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  }) as unknown as NextRequest;
}

beforeAll(() => {
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  process.env.PUBLIC_FRONTEND_URL = "http://localhost:3000";
});

beforeEach(() => {
  calls.length = 0;
  rpcHandler = happyPath;
  vi.stubEnv("CUSTOMER_PAGE_EDITOR_ENABLED", "true");
  vi.stubEnv("CUSTOMER_FLOW_V2_ENABLED", "true");
});

// ─── Feature flag behaviour ──────────────────────────────────────────────

describe("feature flags", () => {
  it("reads CUSTOMER_PAGE_EDITOR_ENABLED on every access, not once at load", async () => {
    vi.resetModules();
    vi.stubEnv("CUSTOMER_PAGE_EDITOR_ENABLED", "false");

    const { customerPageEditorEnabled } = await import("@/lib/server/feature-flags");
    expect(customerPageEditorEnabled()).toBe(false);

    vi.stubEnv("CUSTOMER_PAGE_EDITOR_ENABLED", "true");
    expect(customerPageEditorEnabled()).toBe(true);

    vi.stubEnv("CUSTOMER_PAGE_EDITOR_ENABLED", "0");
    expect(customerPageEditorEnabled()).toBe(false);
  });

  it("reads CUSTOMER_FLOW_V2_ENABLED on every access", async () => {
    vi.resetModules();
    vi.stubEnv("CUSTOMER_FLOW_V2_ENABLED", "false");

    const { customerFlowV2Enabled } = await import("@/lib/server/feature-flags");
    expect(customerFlowV2Enabled()).toBe(false);

    vi.stubEnv("CUSTOMER_FLOW_V2_ENABLED", "1");
    expect(customerFlowV2Enabled()).toBe(true);
  });

  it("accepts 1, true, yes, on — case-insensitive with whitespace", async () => {
    vi.resetModules();
    const { customerPageEditorEnabled } = await import("@/lib/server/feature-flags");

    for (const value of ["1", "true", "TRUE", "True", "yes", "YES", "on", "ON", " true ", " 1\n"]) {
      vi.stubEnv("CUSTOMER_PAGE_EDITOR_ENABLED", value);
      expect(customerPageEditorEnabled(), `"${value}" should be true`).toBe(true);
    }
  });

  it("rejects empty, undefined, and arbitrary strings", async () => {
    vi.resetModules();
    const { customerPageEditorEnabled } = await import("@/lib/server/feature-flags");

    for (const value of ["", "false", "0", "no", "off", "enabled", "sure"]) {
      vi.stubEnv("CUSTOMER_PAGE_EDITOR_ENABLED", value);
      expect(customerPageEditorEnabled(), `"${value}" should be false`).toBe(false);
    }

    delete process.env.CUSTOMER_PAGE_EDITOR_ENABLED;
    expect(customerPageEditorEnabled()).toBe(false);
  });

  it("owner API 404s when editor flag is off", async () => {
    vi.resetModules();
    vi.stubEnv("CUSTOMER_PAGE_EDITOR_ENABLED", "false");

    const { GET } = await import("@/app/api/v1/customer-page/route");
    const response = await GET(request("GET", "/api/v1/customer-page"));

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  it("publish API 404s when editor flag is off", async () => {
    vi.resetModules();
    vi.stubEnv("CUSTOMER_PAGE_EDITOR_ENABLED", "false");

    const { POST } = await import("@/app/api/v1/customer-page/publish/route");
    const response = await POST(request("POST", "/api/v1/customer-page/publish", { body: {} }));

    expect(response.status).toBe(404);
  });

  it("upload API 404s when editor flag is off", async () => {
    vi.resetModules();
    vi.stubEnv("CUSTOMER_PAGE_EDITOR_ENABLED", "false");

    const { POST } = await import("@/app/api/v1/customer-page/upload/route");
    const response = await POST(
      request("POST", "/api/v1/customer-page/upload", {
        body: { kind: "hero", contentType: "image/jpeg" },
      }),
    );

    expect(response.status).toBe(404);
  });
});

// ─── Public context: customerPage extension ──────────────────────────────

describe("public context with V2 enabled", () => {
  it("includes customerPage when V2 flag is on and a published profile exists", async () => {
    vi.resetModules();
    vi.stubEnv("CUSTOMER_FLOW_V2_ENABLED", "true");

    const { getContext } = await import("@/lib/server/customer-flow-service");
    const context = await getContext(TOKEN, {
      address: "127.0.0.1",
      userAgent: "test-agent",
      requestId: "req-1",
    });

    expect(context).toHaveProperty("customerPage");
    expect(context.customerPage).not.toBeNull();
    expect(context.customerPage?.templateId).toBe("modern");
    expect(context.customerPage?.publishedVersion).toBe(1);
  });

  it("omits customerPage when V2 flag is off", async () => {
    vi.resetModules();
    vi.stubEnv("CUSTOMER_FLOW_V2_ENABLED", "false");

    const { getContext } = await import("@/lib/server/customer-flow-service");
    const context = await getContext(TOKEN, {
      address: "127.0.0.1",
      userAgent: "test-agent",
      requestId: "req-2",
    });

    expect(context).not.toHaveProperty("customerPage");
  });

  it("returns null customerPage when no published profile exists", async () => {
    vi.resetModules();
    vi.stubEnv("CUSTOMER_FLOW_V2_ENABLED", "true");

    rpcHandler = (fn) => {
      if (fn === "rpc_consume_rate_limit") return allowed();
      if (fn === "rpc_public_resolve_stand") return { data: [ACTIVE_STAND], error: null };
      if (fn === "rpc_customer_page_resolve_public") return { data: [], error: null };
      return happyPath(fn);
    };

    const { getContext } = await import("@/lib/server/customer-flow-service");
    const context = await getContext(TOKEN, {
      address: "127.0.0.1",
      userAgent: "test-agent",
      requestId: "req-3",
    });

    expect(context).not.toHaveProperty("customerPage");
  });

  it("degrades gracefully when the resolver fails — customerPage omitted, context still served", async () => {
    vi.resetModules();
    vi.stubEnv("CUSTOMER_FLOW_V2_ENABLED", "true");

    rpcHandler = (fn) => {
      if (fn === "rpc_consume_rate_limit") return allowed();
      if (fn === "rpc_public_resolve_stand") return { data: [ACTIVE_STAND], error: null };
      if (fn === "rpc_customer_page_resolve_public")
        return { data: null, error: { message: "connection refused" } };
      return happyPath(fn);
    };

    const { getContext } = await import("@/lib/server/customer-flow-service");
    const context = await getContext(TOKEN, {
      address: "127.0.0.1",
      userAgent: "test-agent",
      requestId: "req-4",
    });

    expect(context.googleReviewUrl).toBe(ACTIVE_STAND.google_review_url);
    expect(context).not.toHaveProperty("customerPage");
  });
});

// ─── Public context secrecy ──────────────────────────────────────────────

describe("public context secrecy with customerPage", () => {
  it("never leaks org, location, or stand ids in the customerPage response", async () => {
    vi.resetModules();
    vi.stubEnv("CUSTOMER_FLOW_V2_ENABLED", "true");

    const { getContext } = await import("@/lib/server/customer-flow-service");
    const context = await getContext(TOKEN, {
      address: "127.0.0.1",
      userAgent: "test-agent",
      requestId: "req-5",
    });

    const serialised = JSON.stringify(context);
    expect(serialised).not.toContain(ORG_ID);
    expect(serialised).not.toContain(LOCATION_ID);
    expect(serialised).not.toContain(STAND_ID);
    expect(serialised).not.toContain(PROFILE_ID);
    expect(serialised.toLowerCase()).not.toContain("org_id");
    expect(serialised.toLowerCase()).not.toContain("location_id");
    expect(serialised.toLowerCase()).not.toContain("stand_id");
  });

  it("never leaks draft data in the public context", async () => {
    vi.resetModules();
    vi.stubEnv("CUSTOMER_FLOW_V2_ENABLED", "true");

    const { getContext } = await import("@/lib/server/customer-flow-service");
    const context = await getContext(TOKEN, {
      address: "127.0.0.1",
      userAgent: "test-agent",
      requestId: "req-6",
    });

    const serialised = JSON.stringify(context);
    expect(serialised.toLowerCase()).not.toContain("draft");
    expect(serialised.toLowerCase()).not.toContain("draft_updated_at");
    expect(serialised.toLowerCase()).not.toContain("draftUpdatedAt");
    expect(serialised.toLowerCase()).not.toContain("composer_version");
  });

  it("never leaks bucket paths in asset URLs", async () => {
    vi.resetModules();
    vi.stubEnv("CUSTOMER_FLOW_V2_ENABLED", "true");
    vi.stubEnv("CUSTOMER_PAGE_PUBLIC_ASSET_BASE", "https://cdn.example.com/assets");

    rpcHandler = (fn) => {
      if (fn === "rpc_consume_rate_limit") return allowed();
      if (fn === "rpc_public_resolve_stand") return { data: [ACTIVE_STAND], error: null };
      if (fn === "rpc_customer_page_resolve_public") return { data: [publicResolverRow()], error: null };
      return happyPath(fn);
    };

    const { getContext } = await import("@/lib/server/customer-flow-service");
    const context = await getContext(TOKEN, {
      address: "127.0.0.1",
      userAgent: "test-agent",
      requestId: "req-7",
    });

    const serialised = JSON.stringify(context);
    expect(serialised).not.toContain("source/");
    if (context.customerPage?.hero) {
      for (const v of context.customerPage.hero.variants) {
        expect(v.url).toMatch(/^https:\/\/cdn\.example\.com\/assets\//);
      }
    }
  });
});

// ─── Owner API: customer page CRUD ───────────────────────────────────────

describe("owner API — customer page GET", () => {
  it("returns the profile shape when editor is enabled", async () => {
    vi.resetModules();

    const { GET } = await import("@/app/api/v1/customer-page/route");
    const response = await GET(request("GET", "/api/v1/customer-page"));

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("scope");
    expect(body).toHaveProperty("draft");
    expect(body).toHaveProperty("publishedVersion");
  });

  it("returns an empty profile when no row exists yet", async () => {
    vi.resetModules();

    rpcHandler = (fn) => {
      if (fn === "rpc_customer_page_get") return { data: [], error: null };
      return happyPath(fn);
    };

    const { GET } = await import("@/app/api/v1/customer-page/route");
    const response = await GET(request("GET", "/api/v1/customer-page"));

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: null,
      scope: "organization",
      draft: {},
      publishedVersion: 0,
      published: null,
    });
  });

  it("passes locationId as a query parameter to the RPC", async () => {
    vi.resetModules();

    const { GET } = await import("@/app/api/v1/customer-page/route");
    await GET(request("GET", `/api/v1/customer-page?locationId=${LOCATION_ID}`));

    const call = calls.find((c) => c.fn === "rpc_customer_page_get");
    expect(call?.args["p_location_id"]).toBe(LOCATION_ID);
  });

  it("rejects a malformed locationId", async () => {
    vi.resetModules();

    const { GET } = await import("@/app/api/v1/customer-page/route");
    const response = await GET(request("GET", "/api/v1/customer-page?locationId=not-a-uuid"));

    expect(response.status).toBe(400);
  });
});

describe("owner API — customer page PATCH", () => {
  it("accepts a valid draft patch and returns the updated profile", async () => {
    vi.resetModules();

    const { PATCH } = await import("@/app/api/v1/customer-page/route");
    const response = await PATCH(
      request("PATCH", "/api/v1/customer-page", {
        body: {
          draft: { templateId: "bold" },
        },
      }),
    );

    expect(response.status).toBe(200);
  });

  it("validates template against the allowed list", async () => {
    vi.resetModules();

    const { PATCH } = await import("@/app/api/v1/customer-page/route");
    const response = await PATCH(
      request("PATCH", "/api/v1/customer-page", {
        body: {
          draft: { templateId: "nonexistent" },
        },
      }),
    );

    expect(response.status).toBe(400);
  });

  it("validates hero focal/zoom ranges", async () => {
    vi.resetModules();

    const { PATCH } = await import("@/app/api/v1/customer-page/route");
    const response = await PATCH(
      request("PATCH", "/api/v1/customer-page", {
        body: {
          draft: {
            hero: { focalX: 2.0, focalY: -1, zoom: 5 },
          },
        },
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects unknown fields in the draft (strict object)", async () => {
    vi.resetModules();

    const { PATCH } = await import("@/app/api/v1/customer-page/route");
    const response = await PATCH(
      request("PATCH", "/api/v1/customer-page", {
        body: {
          draft: { templateId: "modern", secretField: "hacked" },
        },
      }),
    );

    expect(response.status).toBe(400);
  });

  it("accepts all six templates", async () => {
    vi.resetModules();

    const templates = ["signature", "modern", "bold", "editorial", "classic", "minimal"];
    const { PATCH } = await import("@/app/api/v1/customer-page/route");

    for (const templateId of templates) {
      const response = await PATCH(
        request("PATCH", "/api/v1/customer-page", {
          body: { draft: { templateId } },
        }),
      );
      expect(response.status, `template ${templateId}`).toBe(200);
    }
  });
});

describe("owner API — customer page publish", () => {
  it("publishes and returns the updated profile", async () => {
    vi.resetModules();

    const { POST } = await import("@/app/api/v1/customer-page/publish/route");
    const response = await POST(request("POST", "/api/v1/customer-page/publish", { body: {} }));

    expect(response.status).toBe(200);
  });

  it("reports asset-not-ready as 400 validation error", async () => {
    vi.resetModules();

    rpcHandler = (fn) => {
      if (fn === "rpc_customer_page_publish")
        return { data: null, error: { message: "hero_asset_not_ready" } };
      return happyPath(fn);
    };

    const { POST } = await import("@/app/api/v1/customer-page/publish/route");
    const response = await POST(request("POST", "/api/v1/customer-page/publish", { body: {} }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_failed");
  });

  it("reports 'no draft to publish' as 400", async () => {
    vi.resetModules();

    rpcHandler = (fn) => {
      if (fn === "rpc_customer_page_publish")
        return { data: null, error: { message: "no draft to publish" } };
      return happyPath(fn);
    };

    const { POST } = await import("@/app/api/v1/customer-page/publish/route");
    const response = await POST(request("POST", "/api/v1/customer-page/publish", { body: {} }));

    expect(response.status).toBe(400);
  });
});

describe("owner API — asset upload", () => {
  it("creates a reservation and returns assetId with null uploadUrl", async () => {
    vi.resetModules();

    const { POST } = await import("@/app/api/v1/customer-page/upload/route");
    const response = await POST(
      request("POST", "/api/v1/customer-page/upload", {
        body: { kind: "hero", contentType: "image/jpeg" },
      }),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("assetId");
    expect(body.uploadUrl).toBeNull();
    expect(body).toHaveProperty("sourceObjectPath");
  });

  it("rejects unsupported content types", async () => {
    vi.resetModules();

    const { POST } = await import("@/app/api/v1/customer-page/upload/route");
    const response = await POST(
      request("POST", "/api/v1/customer-page/upload", {
        body: { kind: "hero", contentType: "image/svg+xml" },
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects unsupported kind values", async () => {
    vi.resetModules();

    const { POST } = await import("@/app/api/v1/customer-page/upload/route");
    const response = await POST(
      request("POST", "/api/v1/customer-page/upload", {
        body: { kind: "banner", contentType: "image/png" },
      }),
    );

    expect(response.status).toBe(400);
  });

  it("generates an opaque source path that contains no org names or tokens", async () => {
    vi.resetModules();

    const { POST } = await import("@/app/api/v1/customer-page/upload/route");
    const response = await POST(
      request("POST", "/api/v1/customer-page/upload", {
        body: { kind: "logo", contentType: "image/png" },
      }),
    );

    const body = (await response.json()) as { sourceObjectPath: string };
    expect(body.sourceObjectPath).toMatch(/^customer-page\/source\/[0-9a-f]{2}\/[0-9a-f]+\.png$/);
    expect(body.sourceObjectPath).not.toContain(ORG_ID);
    expect(body.sourceObjectPath).not.toContain("corner-cafe");
  });
});

// ─── Service-layer invariants ────────────────────────────────────────────

describe("customer page service", () => {
  it("projectProfile returns an empty view when no row exists", async () => {
    vi.resetModules();

    rpcHandler = (fn) => {
      if (fn === "rpc_customer_page_get") return { data: [], error: null };
      return happyPath(fn);
    };

    const { getCustomerPageProfile } = await import("@/lib/server/customer-page-service");
    const profile = await getCustomerPageProfile(
      { userId: "u", orgId: ORG_ID, role: "owner", db: mockAuthenticatedDb } as never,
      ORG_ID,
      null,
      "req-svc-1",
    );

    expect(profile.id).toBeNull();
    expect(profile.draft).toEqual({});
    expect(profile.published).toBeNull();
    expect(profile.publishedVersion).toBe(0);
  });

  it("coerces null draft to empty object", async () => {
    vi.resetModules();

    rpcHandler = (fn) => {
      if (fn === "rpc_customer_page_get")
        return { data: [profileRow({ draft: null })], error: null };
      return happyPath(fn);
    };

    const { getCustomerPageProfile } = await import("@/lib/server/customer-page-service");
    const profile = await getCustomerPageProfile(
      { userId: "u", orgId: ORG_ID, role: "owner", db: mockAuthenticatedDb } as never,
      ORG_ID,
      null,
      "req-svc-2",
    );

    expect(profile.draft).toEqual({});
  });

  it("published is null when publishedVersion is 0", async () => {
    vi.resetModules();

    rpcHandler = (fn) => {
      if (fn === "rpc_customer_page_get")
        return {
          data: [profileRow({ published_version: 0, published: { templateId: "modern" } })],
          error: null,
        };
      return happyPath(fn);
    };

    const { getCustomerPageProfile } = await import("@/lib/server/customer-page-service");
    const profile = await getCustomerPageProfile(
      { userId: "u", orgId: ORG_ID, role: "owner", db: mockAuthenticatedDb } as never,
      ORG_ID,
      null,
      "req-svc-3",
    );

    expect(profile.published).toBeNull();
  });

  it("public resolver clamps focal/zoom values to valid ranges", async () => {
    vi.resetModules();
    vi.stubEnv("CUSTOMER_PAGE_PUBLIC_ASSET_BASE", "https://cdn.example.com/assets");

    rpcHandler = (fn) => {
      if (fn === "rpc_customer_page_resolve_public") {
        return {
          data: [
            {
              ...publicResolverRow(),
              published: { templateId: "modern", hero: { focalX: 5, focalY: -2, zoom: 10 } },
            },
          ],
          error: null,
        };
      }
      return happyPath(fn);
    };

    const { resolvePublicCustomerPage } = await import("@/lib/server/customer-page-service");
    const result = await resolvePublicCustomerPage(ORG_ID, LOCATION_ID, "req-clamp");

    expect(result?.hero?.focalX).toBeLessThanOrEqual(1);
    expect(result?.hero?.focalX).toBeGreaterThanOrEqual(0);
    expect(result?.hero?.focalY).toBeLessThanOrEqual(1);
    expect(result?.hero?.focalY).toBeGreaterThanOrEqual(0);
    expect(result?.hero?.zoom).toBeLessThanOrEqual(1.5);
    expect(result?.hero?.zoom).toBeGreaterThanOrEqual(1);
  });

  it("public resolver returns null for an invalid templateId in the database", async () => {
    vi.resetModules();

    rpcHandler = (fn) => {
      if (fn === "rpc_customer_page_resolve_public") {
        return {
          data: [
            {
              ...publicResolverRow(),
              published: { templateId: "hackedTemplate" },
            },
          ],
          error: null,
        };
      }
      return happyPath(fn);
    };

    const { resolvePublicCustomerPage } = await import("@/lib/server/customer-page-service");
    const result = await resolvePublicCustomerPage(ORG_ID, LOCATION_ID, "req-invalid-tpl");

    expect(result).toBeNull();
  });

  it("public resolver returns null when published_version is 0", async () => {
    vi.resetModules();

    rpcHandler = (fn) => {
      if (fn === "rpc_customer_page_resolve_public") {
        return {
          data: [{ ...publicResolverRow(), published_version: 0 }],
          error: null,
        };
      }
      return happyPath(fn);
    };

    const { resolvePublicCustomerPage } = await import("@/lib/server/customer-page-service");
    const result = await resolvePublicCustomerPage(ORG_ID, LOCATION_ID, "req-v0");

    expect(result).toBeNull();
  });

  it("publicAssetUrl constructs CDN urls and normalises slashes", async () => {
    vi.resetModules();
    vi.stubEnv("CUSTOMER_PAGE_PUBLIC_ASSET_BASE", "https://cdn.example.com/assets/");

    rpcHandler = (fn) => {
      if (fn === "rpc_customer_page_resolve_public") return { data: [publicResolverRow()], error: null };
      return happyPath(fn);
    };

    const { resolvePublicCustomerPage } = await import("@/lib/server/customer-page-service");
    const result = await resolvePublicCustomerPage(ORG_ID, LOCATION_ID, "req-url");

    const heroUrl = result?.hero?.variants[0]?.url;
    expect(heroUrl).toBe("https://cdn.example.com/assets/customer-page/public/ab/hero-800.webp");
    expect(heroUrl).not.toContain("//customer");
  });

  it("publicAssetUrl falls back to raw path when no base is configured", async () => {
    vi.resetModules();
    delete process.env.CUSTOMER_PAGE_PUBLIC_ASSET_BASE;

    rpcHandler = (fn) => {
      if (fn === "rpc_customer_page_resolve_public") return { data: [publicResolverRow()], error: null };
      return happyPath(fn);
    };

    const { resolvePublicCustomerPage } = await import("@/lib/server/customer-page-service");
    const result = await resolvePublicCustomerPage(ORG_ID, LOCATION_ID, "req-raw");

    expect(result?.hero?.variants[0]?.url).toBe("customer-page/public/ab/hero-800.webp");
  });
});

// ─── Ratings remain uniform with V2 ─────────────────────────────────────

describe("V2 does not change rating uniformity", () => {
  it("getContext returns the same shape for every call — rating is not part of context", async () => {
    vi.resetModules();
    vi.stubEnv("CUSTOMER_FLOW_V2_ENABLED", "true");

    const { getContext } = await import("@/lib/server/customer-flow-service");

    const shapes: string[] = [];
    for (let i = 0; i < 3; i++) {
      const context = await getContext(TOKEN, {
        address: "127.0.0.1",
        userAgent: "test-agent",
        requestId: `req-uniform-${i}`,
      });
      shapes.push(JSON.stringify(Object.keys(context).sort()));
    }

    expect(new Set(shapes).size).toBe(1);
  });

  it("the customerPage field contains no threshold, gating, or rating reference", async () => {
    vi.resetModules();
    vi.stubEnv("CUSTOMER_FLOW_V2_ENABLED", "true");

    const { getContext } = await import("@/lib/server/customer-flow-service");
    const context = await getContext(TOKEN, {
      address: "127.0.0.1",
      userAgent: "test-agent",
      requestId: "req-no-gate",
    });

    const serialised = JSON.stringify(context.customerPage ?? {}).toLowerCase();
    expect(serialised).not.toContain("threshold");
    expect(serialised).not.toContain("gating");
    expect(serialised).not.toContain("rating");
    expect(serialised).not.toContain("minimum");
  });
});

// ─── Existing flow preserved ─────────────────────────────────────────────

describe("existing public flow preserved with V2", () => {
  it("all existing context fields still present when V2 is on", async () => {
    vi.resetModules();
    vi.stubEnv("CUSTOMER_FLOW_V2_ENABLED", "true");

    const { getContext } = await import("@/lib/server/customer-flow-service");
    const context = await getContext(TOKEN, {
      address: "127.0.0.1",
      userAgent: "test-agent",
      requestId: "req-compat-1",
    });

    expect(context).toHaveProperty("business");
    expect(context).toHaveProperty("location");
    expect(context).toHaveProperty("googleReviewUrl");
    expect(context).toHaveProperty("supportedLocales");
    expect(context).toHaveProperty("defaultLocale");
    expect(context.googleReviewUrl).toBe(ACTIVE_STAND.google_review_url);
    expect(context.business).toEqual({ name: "The Corner Cafe", logoUrl: null });
  });

  it("all existing context fields still present when V2 is off", async () => {
    vi.resetModules();
    vi.stubEnv("CUSTOMER_FLOW_V2_ENABLED", "false");

    const { getContext } = await import("@/lib/server/customer-flow-service");
    const context = await getContext(TOKEN, {
      address: "127.0.0.1",
      userAgent: "test-agent",
      requestId: "req-compat-2",
    });

    expect(context).toHaveProperty("business");
    expect(context).toHaveProperty("location");
    expect(context).toHaveProperty("googleReviewUrl");
    expect(context).toHaveProperty("supportedLocales");
    expect(context).toHaveProperty("defaultLocale");
    expect(context).not.toHaveProperty("customerPage");
  });
});

// ─── CORS on owner endpoints ─────────────────────────────────────────────

describe("owner API CORS", () => {
  it("customer-page route responds to OPTIONS", async () => {
    vi.resetModules();

    const { OPTIONS } = await import("@/app/api/v1/customer-page/route");
    const response = await OPTIONS(
      request("OPTIONS", "/api/v1/customer-page", {
        headers: { origin: "http://localhost:3000" },
      }),
    );

    expect(response.status).toBe(204);
  });

  it("publish route responds to OPTIONS", async () => {
    vi.resetModules();

    const { OPTIONS } = await import("@/app/api/v1/customer-page/publish/route");
    const response = await OPTIONS(
      request("OPTIONS", "/api/v1/customer-page/publish", {
        headers: { origin: "http://localhost:3000" },
      }),
    );

    expect(response.status).toBe(204);
  });

  it("upload route responds to OPTIONS", async () => {
    vi.resetModules();

    const { OPTIONS } = await import("@/app/api/v1/customer-page/upload/route");
    const response = await OPTIONS(
      request("OPTIONS", "/api/v1/customer-page/upload", {
        headers: { origin: "http://localhost:3000" },
      }),
    );

    expect(response.status).toBe(204);
  });
});
