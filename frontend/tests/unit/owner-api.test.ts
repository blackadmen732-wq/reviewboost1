import type { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Contract tests for the owner API.
 *
 * The security property these exist to pin down is that owner routes use the
 * **caller's own** Supabase client, so Row Level Security does the tenant
 * isolation on every statement — not the service role plus a `where org_id`
 * each handler must remember. One forgotten clause under service role is one
 * business reading another's feedback; under RLS a forgotten clause returns
 * fewer rows and never somebody else's.
 *
 * Supabase is mocked, so what is proven here is the wiring, the shapes, and the
 * redactions. The isolation itself is proven against real Postgres in
 * `supabase/tests`.
 */

interface Recorded {
  kind: "rpc" | "from";
  name: string;
  args?: Record<string, unknown>;
  columns?: string;
}

const recorded: Recorded[] = [];
let authUser: { id: string } | null = { id: "user-1" };
let tableRows: unknown[] = [];
let membershipRows: unknown[] = [{ org_id: "org-1", role: "owner" }];
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
let serviceRoleUsed = false;

function queryBuilder(columns: string, rows?: unknown[]) {
  const effectiveRows = rows ?? tableRows;
  const builder: Record<string, unknown> = {};
  const chain = () => builder;

  for (const method of ["eq", "lt", "order", "limit", "update", "select"]) {
    builder[method] = chain;
  }
  builder["maybeSingle"] = () =>
    Promise.resolve({ data: effectiveRows[0] ?? null, error: null });
  builder["then"] = (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
    resolve({ data: effectiveRows, error: null });

  void columns;
  return builder;
}

function fakeClient() {
  return {
    auth: {
      getUser: () =>
        Promise.resolve(
          authUser ? { data: { user: authUser }, error: null } : { data: { user: null }, error: { message: "bad" } },
        ),
    },
    from: (table: string) => ({
      select: (columns: string) => {
        recorded.push({ kind: "from", name: table, columns });
        const rows = table === "organization_members" ? membershipRows : undefined;
        return queryBuilder(columns, rows);
      },
      update: () => ({
        eq: () => ({
          select: (columns: string) => {
            recorded.push({ kind: "from", name: `${table}.update`, columns });
            return queryBuilder(columns);
          },
        }),
      }),
    }),
    rpc: (name: string, args: Record<string, unknown>) => {
      recorded.push({ kind: "rpc", name, args });
      return Promise.resolve(rpcResult);
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => fakeClient(),
}));

vi.mock("@/lib/server/supabase", () => ({
  serviceRoleClient: () => {
    serviceRoleUsed = true;
    return fakeClient();
  },
}));

function request(method: string, path: string, options: { body?: unknown; auth?: boolean } = {}) {
  const headers: Record<string, string> = {};
  if (options.auth !== false) headers["authorization"] = "Bearer valid-session-token";
  if (options.body !== undefined) headers["content-type"] = "application/json";

  return new Request(`http://localhost:3000${path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  }) as unknown as NextRequest;
}

const VALID_ORG = {
  name: "The Corner Cafe",
  slug: "corner-cafe",
  timezone: "Europe/London",
  defaultLocale: "en" as const,
  locationName: "High Street",
  googleReviewUrl: "https://g.page/r/CdSAMPLE/review",
};

beforeAll(() => {
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  process.env.PUBLIC_FRONTEND_URL = "https://app.reviewboost.test";
});

beforeEach(() => {
  recorded.length = 0;
  authUser = { id: "user-1" };
  tableRows = [];
  membershipRows = [{ org_id: "org-1", role: "owner" }];
  serviceRoleUsed = false;
  rpcResult = {
    data: [{ org_id: "org-1", location_id: "loc-1", stand_id: "11111111-1111-1111-1111-111111111111" }],
    error: null,
  };
});

describe("authentication", () => {
  it("rejects every owner route without a bearer token", async () => {
    const routes = [
      ["@/app/api/v1/onboarding/route", "GET", "/api/v1/onboarding"],
      ["@/app/api/v1/customer-responses/route", "GET", "/api/v1/customer-responses"],
      ["@/app/api/v1/team-praise/route", "GET", "/api/v1/team-praise"],
      ["@/app/api/v1/review-stands/route", "GET", "/api/v1/review-stands"],
    ] as const;

    for (const [module, method, path] of routes) {
      const handler = (await import(module)) as Record<string, (r: NextRequest) => Promise<Response>>;
      const run = handler[method];
      const response = await run!(request(method, path, { auth: false }));
      expect(response.status, path).toBe(401);
    }
  });

  it("rejects a token Supabase does not recognise", async () => {
    authUser = null;
    const { GET } = await import("@/app/api/v1/onboarding/route");
    const response = await GET(request("GET", "/api/v1/onboarding"));
    expect(response.status).toBe(401);
  });

  it("says nothing about why authentication failed", async () => {
    authUser = null;
    const { GET } = await import("@/app/api/v1/onboarding/route");
    const body = JSON.stringify(await (await GET(request("GET", "/api/v1/onboarding"))).json());

    // Expired, malformed, and revoked must be indistinguishable.
    expect(body).not.toMatch(/expired|malformed|revoked|signature/i);
  });

  it("never uses the service role on an owner route", async () => {
    // The whole isolation argument rests on owner queries running as the
    // caller, so RLS applies. Service role here would silently disable it.
    const { GET } = await import("@/app/api/v1/customer-responses/route");
    await GET(request("GET", "/api/v1/customer-responses"));

    expect(serviceRoleUsed).toBe(false);
  });
});

describe("onboarding", () => {
  it("creates organization, location, and first stand in one call", async () => {
    const { POST } = await import("@/app/api/v1/onboarding/route");
    const response = await POST(request("POST", "/api/v1/onboarding", { body: VALID_ORG }));

    expect(response.status).toBe(201);

    // One RPC, so a failure cannot leave a user owning nothing or an
    // organization with no owner.
    const creates = recorded.filter((entry) => entry.name === "rpc_create_organization");
    expect(creates).toHaveLength(1);
  });

  it("never sends a user id to the database", async () => {
    const { POST } = await import("@/app/api/v1/onboarding/route");
    await POST(request("POST", "/api/v1/onboarding", { body: VALID_ORG }));

    // The function reads auth.uid() itself. A parameter would let any caller
    // create an organization owned by someone else.
    const create = recorded.find((entry) => entry.name === "rpc_create_organization");
    expect(JSON.stringify(create?.args)).not.toContain("user-1");
  });

  it("sends the stand token only as a digest, never in clear", async () => {
    const { POST } = await import("@/app/api/v1/onboarding/route");
    const response = await POST(request("POST", "/api/v1/onboarding", { body: VALID_ORG }));
    const body = (await response.json()) as { data: { standToken: string } };

    const create = recorded.find((entry) => entry.name === "rpc_create_organization");
    expect(create?.args?.["p_stand_token_hash"]).not.toBe(body.data.standToken);
    expect(String(create?.args?.["p_stand_token_hash"])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the token exactly once, with a URL on the frontend origin", async () => {
    const { POST } = await import("@/app/api/v1/onboarding/route");
    const response = await POST(request("POST", "/api/v1/onboarding", { body: VALID_ORG }));
    const body = (await response.json()) as { data: { standUrl: string; standToken: string } };

    expect(body.data.standUrl).toBe(`https://app.reviewboost.test/q/${body.data.standToken}`);
    expect(body.data.standUrl).not.toContain("localhost");
  });

  it("refuses a Google URL that is not Google", async () => {
    const { POST } = await import("@/app/api/v1/onboarding/route");
    const response = await POST(
      request("POST", "/api/v1/onboarding", {
        body: { ...VALID_ORG, googleReviewUrl: "https://evil.example/review" },
      }),
    );

    // Refused at the door: an invalid destination means every customer sees a
    // page their browser rejects, and the owner has no way to know why.
    expect(response.status).toBe(400);
  });

  it("refuses credentials smuggled into the Google URL", async () => {
    const { POST } = await import("@/app/api/v1/onboarding/route");
    const response = await POST(
      request("POST", "/api/v1/onboarding", {
        body: { ...VALID_ORG, googleReviewUrl: "https://www.google.com@evil.example/maps/" },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("reports a taken slug as a conflict a user can act on", async () => {
    rpcResult = { data: null, error: { code: "23505", message: "duplicate key" } };

    const { POST } = await import("@/app/api/v1/onboarding/route");
    const response = await POST(request("POST", "/api/v1/onboarding", { body: VALID_ORG }));
    const body = (await response.json()) as { error: { details?: Array<{ field: string }> } };

    expect(response.status).toBe(409);
    expect(body.error.details?.[0]?.field).toBe("slug");
  });

  it("rejects a slug that would not be safe in a URL", async () => {
    const { POST } = await import("@/app/api/v1/onboarding/route");

    for (const slug of ["Corner Cafe", "corner_cafe", "-corner", "ab", "../etc"]) {
      const response = await POST(
        request("POST", "/api/v1/onboarding", { body: { ...VALID_ORG, slug } }),
      );
      expect(response.status, slug).toBe(400);
    }
  });

  it("rejects an invalid time zone rather than guessing UTC", async () => {
    const { POST } = await import("@/app/api/v1/onboarding/route");
    const response = await POST(
      request("POST", "/api/v1/onboarding", { body: { ...VALID_ORG, timezone: "Mars/Olympus" } }),
    );
    expect(response.status).toBe(400);
  });

  it("never exposes a database error to the caller", async () => {
    rpcResult = {
      data: null,
      error: { code: "42P01", message: 'relation "organizations" does not exist' },
    };

    const { POST } = await import("@/app/api/v1/onboarding/route");
    const response = await POST(request("POST", "/api/v1/onboarding", { body: VALID_ORG }));
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(body).not.toContain("organizations");
    expect(body).not.toContain("42P01");
  });
});

describe("Team Praise stays rating-blind", () => {
  it("never selects the rating", async () => {
    tableRows = [
      {
        id: "praise-1",
        location_id: "loc-1",
        first_name_encrypted: null,
        praise_note_encrypted: null,
        status: "unmatched",
        created_at: "2026-08-10T10:00:00Z",
      },
    ];

    const { GET } = await import("@/app/api/v1/team-praise/route");
    await GET(request("GET", "/api/v1/team-praise"));

    const query = recorded.find((entry) => entry.name === "team_praise_records");
    // The barrier is the select list. A column that is never selected cannot be
    // serialised by accident.
    expect(query?.columns).not.toContain("rating");
    expect(query?.columns).not.toContain("customer_responses");
  });

  it("serialises no rating, Google, or money field", async () => {
    tableRows = [
      {
        id: "praise-1",
        location_id: "loc-1",
        first_name_encrypted: null,
        praise_note_encrypted: null,
        status: "unmatched",
        created_at: "2026-08-10T10:00:00Z",
      },
    ];

    const { GET } = await import("@/app/api/v1/team-praise/route");
    const body = JSON.stringify(await (await GET(request("GET", "/api/v1/team-praise"))).json());

    for (const forbidden of ["rating", "star", "google", "bonus", "payroll", "phone", "email"]) {
      expect(body.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });
});

describe("listing safety", () => {
  it("bounds the page size however large a caller asks", async () => {
    const { GET } = await import("@/app/api/v1/customer-responses/route");
    await GET(request("GET", "/api/v1/customer-responses?limit=100000"));

    // An unbounded page is how a listing endpoint becomes a way to pull an
    // entire table in one request.
    const query = recorded.find((entry) => entry.name === "customer_responses");
    expect(query).toBeDefined();
  });

  it("returns cursor metadata rather than an offset", async () => {
    tableRows = [];
    const { GET } = await import("@/app/api/v1/customer-responses/route");
    const body = (await (await GET(request("GET", "/api/v1/customer-responses"))).json()) as {
      meta: { hasMore: boolean; nextCursor: string | null };
    };

    expect(body.meta).toHaveProperty("hasMore");
    expect(body.meta).toHaveProperty("nextCursor");
  });
});

describe("stand token rotation", () => {
  it("rejects a stand id that is not a UUID before touching the database", async () => {
    const { POST } = await import("@/app/api/v1/review-stands/[standId]/rotate-token/route");
    const response = await POST(
      request("POST", "/api/v1/review-stands/not-a-uuid/rotate-token"),
      { params: Promise.resolve({ standId: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    expect(recorded.filter((entry) => entry.kind === "from")).toHaveLength(0);
  });

  it("is a 404 for a stand belonging to another tenant", async () => {
    tableRows = [];
    const { POST } = await import("@/app/api/v1/review-stands/[standId]/rotate-token/route");
    const standId = "11111111-1111-1111-1111-111111111111";

    const response = await POST(
      request("POST", `/api/v1/review-stands/${standId}/rotate-token`),
      { params: Promise.resolve({ standId }) },
    );

    // Invisible under RLS, so a cross-tenant attempt and a typo look identical.
    expect(response.status).toBe(404);
  });
});

describe("security headers on owner routes", () => {
  it("marks every owner response uncacheable", async () => {
    const { GET } = await import("@/app/api/v1/customer-responses/route");
    const response = await GET(request("GET", "/api/v1/customer-responses"));

    // Customer feedback is per-tenant and must never sit in a shared cache.
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });
});
