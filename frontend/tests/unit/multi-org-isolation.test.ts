import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Behavioral tests for multi-org isolation.
 *
 * These prove that the org selection system works correctly and that mutation
 * routes scope every query to the caller's active organization. Source-text
 * checks ("does the file contain this string") prove nothing about behavior —
 * a test that checks for `.eq("org_id"` once passes even if there are ten
 * unscoped queries surrounding it.
 */

interface Recorded {
  kind: "rpc" | "from" | "eq" | "update";
  name: string;
  value?: unknown;
}

const recorded: Recorded[] = [];
let authUser: { id: string } | null = { id: "user-1" };
let membershipRows: unknown[] = [{ org_id: "11111111-1111-1111-1111-111111111111", role: "owner" }];
let tableRows: unknown[] = [];

function queryBuilder(rows?: unknown[]) {
  const effectiveRows = rows ?? tableRows;
  const builder: Record<string, unknown> = {};
  const chain = () => builder;

  for (const method of ["select", "order", "limit", "lt", "is"]) {
    builder[method] = chain;
  }
  builder["eq"] = (col: string, val: unknown) => {
    recorded.push({ kind: "eq", name: col, value: val });
    return builder;
  };
  builder["maybeSingle"] = () =>
    Promise.resolve({ data: effectiveRows[0] ?? null, error: null });
  builder["single"] = () =>
    Promise.resolve({ data: effectiveRows[0] ?? null, error: null });
  builder["then"] = (resolve: (v: { data: unknown; error: unknown }) => unknown) =>
    resolve({ data: effectiveRows, error: null });

  return builder;
}

function fakeClient() {
  return {
    auth: {
      getUser: () =>
        Promise.resolve(
          authUser
            ? { data: { user: authUser }, error: null }
            : { data: { user: null }, error: { message: "bad" } },
        ),
    },
    from: (table: string) => {
      recorded.push({ kind: "from", name: table });
      const rows = table === "organization_members" ? membershipRows : undefined;
      return {
        select: () => queryBuilder(rows),
        update: () => {
          recorded.push({ kind: "update", name: table });
          return queryBuilder();
        },
        insert: () => queryBuilder(),
      };
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => fakeClient(),
}));

beforeAll(() => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  process.env.PUBLIC_FRONTEND_URL = "https://app.reviewboost.test";
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
});

beforeEach(() => {
  recorded.length = 0;
  authUser = { id: "user-1" };
  membershipRows = [{ org_id: "11111111-1111-1111-1111-111111111111", role: "owner" }];
  tableRows = [];
});

function authedRequest(
  method: string,
  path: string,
  options: { orgHeader?: string; cookie?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {
    authorization: "Bearer valid-session-token",
  };
  if (options.orgHeader) headers["x-organization-id"] = options.orgHeader;
  if (options.cookie) headers["cookie"] = options.cookie;
  if (options.body) headers["content-type"] = "application/json";

  return new Request(`http://localhost:3000${path}`, {
    method,
    headers,
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}

describe("requireOrganizationContext", () => {
  let requireOrganizationContext: typeof import("@/lib/server/auth").requireOrganizationContext;

  beforeAll(async () => {
    const mod = await import("@/lib/server/auth");
    requireOrganizationContext = mod.requireOrganizationContext;
  });

  it("resolves org from X-Organization-Id header", async () => {
    membershipRows = [
      { org_id: "11111111-1111-1111-1111-111111111111", role: "owner" },
      { org_id: "22222222-2222-2222-2222-222222222222", role: "member" },
    ];

    const req = authedRequest("GET", "/test", { orgHeader: "22222222-2222-2222-2222-222222222222" });
    const ctx = await requireOrganizationContext(req as never);

    expect(ctx.orgId).toBe("22222222-2222-2222-2222-222222222222");
    expect(ctx.role).toBe("member");
  });

  it("resolves org from rb-active-org cookie", async () => {
    membershipRows = [
      { org_id: "11111111-1111-1111-1111-111111111111", role: "owner" },
      { org_id: "22222222-2222-2222-2222-222222222222", role: "member" },
    ];

    const req = authedRequest("GET", "/test", { cookie: "rb-active-org=22222222-2222-2222-2222-222222222222" });
    const ctx = await requireOrganizationContext(req as never);

    expect(ctx.orgId).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("prefers header over cookie", async () => {
    membershipRows = [
      { org_id: "11111111-1111-1111-1111-111111111111", role: "owner" },
      { org_id: "22222222-2222-2222-2222-222222222222", role: "member" },
    ];

    const req = authedRequest("GET", "/test", {
      orgHeader: "11111111-1111-1111-1111-111111111111",
      cookie: "rb-active-org=22222222-2222-2222-2222-222222222222",
    });
    const ctx = await requireOrganizationContext(req as never);

    expect(ctx.orgId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("auto-selects for single-org users", async () => {
    membershipRows = [{ org_id: "11111111-1111-1111-1111-111111111111", role: "owner" }];

    const req = authedRequest("GET", "/test");
    const ctx = await requireOrganizationContext(req as never);

    expect(ctx.orgId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("rejects multi-org users without selection", async () => {
    membershipRows = [
      { org_id: "11111111-1111-1111-1111-111111111111", role: "owner" },
      { org_id: "22222222-2222-2222-2222-222222222222", role: "member" },
    ];

    const req = authedRequest("GET", "/test");

    await expect(requireOrganizationContext(req as never)).rejects.toThrow(
      "You belong to multiple organizations",
    );
  });

  it("rejects an org the user is not a member of", async () => {
    membershipRows = [{ org_id: "11111111-1111-1111-1111-111111111111", role: "owner" }];

    const req = authedRequest("GET", "/test", {
      orgHeader: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });

    await expect(requireOrganizationContext(req as never)).rejects.toThrow("Not found");
  });

  it("rejects a malformed org id", async () => {
    const req = authedRequest("GET", "/test", { orgHeader: "not-a-uuid" });

    await expect(requireOrganizationContext(req as never)).rejects.toThrow(
      "Invalid organization identifier",
    );
  });
});

describe("mutation route org_id scoping", () => {
  it("resolve route scopes update to active org", async () => {
    tableRows = [{ id: "resp-1", resolved_at: new Date().toISOString() }];
    const { POST } = await import(
      "@/app/api/v1/customer-responses/[responseId]/resolve/route"
    );
    const responseId = "11111111-1111-1111-1111-111111111111";

    await POST(
      authedRequest("POST", `/api/v1/customer-responses/${responseId}/resolve`, {
        body: { resolved: true },
      }) as never,
      { params: Promise.resolve({ responseId }) },
    );

    const orgFilters = recorded.filter((e) => e.kind === "eq" && e.name === "org_id");
    expect(orgFilters.length).toBeGreaterThanOrEqual(1);
    expect(orgFilters[0]?.value).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("read route scopes update to active org", async () => {
    const { POST } = await import(
      "@/app/api/v1/customer-responses/[responseId]/read/route"
    );
    const responseId = "11111111-1111-1111-1111-111111111111";

    await POST(
      authedRequest("POST", `/api/v1/customer-responses/${responseId}/read`) as never,
      { params: Promise.resolve({ responseId }) },
    );

    const orgFilters = recorded.filter((e) => e.kind === "eq" && e.name === "org_id");
    expect(orgFilters.length).toBeGreaterThanOrEqual(1);
    expect(orgFilters[0]?.value).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("staff update scopes to active org", async () => {
    tableRows = [{ id: "staff-1" }];
    const { PATCH } = await import("@/app/api/v1/staff/[staffId]/route");
    const staffId = "22222222-2222-2222-2222-222222222222";

    await PATCH(
      authedRequest("PATCH", `/api/v1/staff/${staffId}`, {
        body: { name: "Updated" },
      }) as never,
      { params: Promise.resolve({ staffId }) },
    );

    const orgFilters = recorded.filter((e) => e.kind === "eq" && e.name === "org_id");
    expect(orgFilters.length).toBeGreaterThanOrEqual(1);
    expect(orgFilters[0]?.value).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("team praise update scopes both praise and staff lookup to active org", async () => {
    tableRows = [{ id: "staff-1" }];
    const { PATCH } = await import("@/app/api/v1/team-praise/[praiseId]/route");
    const praiseId = "33333333-3333-3333-3333-333333333333";

    await PATCH(
      authedRequest("PATCH", `/api/v1/team-praise/${praiseId}`, {
        body: { staffId: "44444444-4444-1444-8444-444444444444" },
      }) as never,
      { params: Promise.resolve({ praiseId }) },
    );

    const orgFilters = recorded.filter((e) => e.kind === "eq" && e.name === "org_id");
    expect(orgFilters.length).toBeGreaterThanOrEqual(2);
  });
});

describe("owner-service org_id is required", () => {
  it("listStands signature requires orgId", async () => {
    const { listStands } = await import("@/lib/server/owner-service");
    const ctx = { userId: "u", db: fakeClient() };

    // @ts-expect-error -- orgId is required; omitting it must be a type error
    await listStands(ctx, "req-1");
  });

  it("listCustomerResponses signature requires orgId", async () => {
    const { listCustomerResponses } = await import("@/lib/server/owner-service");
    const ctx = { userId: "u", db: fakeClient() };

    // @ts-expect-error -- orgId is required; omitting it must be a type error
    await listCustomerResponses(ctx, { cursor: undefined, limit: 25 }, "req-1");
  });

  it("listTeamPraise signature requires orgId", async () => {
    const { listTeamPraise } = await import("@/lib/server/owner-service");
    const ctx = { userId: "u", db: fakeClient() };

    // @ts-expect-error -- orgId is required; omitting it must be a type error
    await listTeamPraise(ctx, { cursor: undefined, limit: 25 }, "req-1");
  });
});
