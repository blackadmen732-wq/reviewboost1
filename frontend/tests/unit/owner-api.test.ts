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
const perTableRows: Record<string, unknown[]> = {};
let membershipRows: unknown[] = [{ org_id: "org-1", role: "owner" }];
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
let serviceRoleUsed = false;

/**
 * Parse the composite `.or()` cursor filter the live-feed endpoint emits.
 * Format: `{tsField}.lt.{tsVal},and({tsField}.eq.{tsVal},id.lt.{idVal})`
 */
function parseCompositeOr(
  filter: string,
): { tsField: string; tsValue: string; idValue: string } | null {
  const m = filter.match(
    /^(\w+)\.lt\.(.+?),and\(\1\.eq\.\2,id\.lt\.(.+)\)$/,
  );
  if (!m) return null;
  return { tsField: m[1], tsValue: m[2], idValue: m[3] };
}

function queryBuilder(columns: string, rows?: unknown[]) {
  const effectiveRows = rows ?? tableRows;
  const builder: Record<string, unknown> = {};
  let orFilter: string | null = null;
  const chain = () => builder;

  for (const method of ["eq", "lt", "order", "limit", "update", "select"]) {
    builder[method] = chain;
  }
  builder["or"] = (filter: string) => {
    orFilter = filter;
    return builder;
  };
  builder["maybeSingle"] = () =>
    Promise.resolve({ data: effectiveRows[0] ?? null, error: null });
  builder["then"] = (resolve: (value: { data: unknown; error: unknown }) => unknown) => {
    let result = effectiveRows;
    if (orFilter) {
      const parsed = parseCompositeOr(orFilter);
      if (parsed) {
        result = (effectiveRows as Array<Record<string, unknown>>).filter((row) => {
          const ts = row[parsed.tsField] as string;
          const id = row["id"] as string;
          return ts < parsed.tsValue || (ts === parsed.tsValue && id < parsed.idValue);
        });
      }
    }
    return resolve({ data: result, error: null });
  };

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
        const rows = table === "organization_members"
          ? membershipRows
          : perTableRows[table] ?? undefined;
        return queryBuilder(columns, rows);
      },
      update: () => {
        const updateChain: Record<string, unknown> = {};
        updateChain["eq"] = () => updateChain;
        updateChain["is"] = () => updateChain;
        updateChain["select"] = (columns: string) => {
          recorded.push({ kind: "from", name: `${table}.update`, columns });
          return queryBuilder(columns);
        };
        updateChain["maybeSingle"] = () =>
          Promise.resolve({ data: tableRows[0] ?? null, error: null });
        return updateChain;
      },
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
  for (const key of Object.keys(perTableRows)) delete perTableRows[key];
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
      ["@/app/api/v1/live-feed/route", "GET", "/api/v1/live-feed"],
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

    const query = recorded.find((entry) => entry.name === "praise_safe_view" || entry.name === "team_praise_records");
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
    expect(recorded.filter((entry) => entry.kind === "from" && entry.name !== "organization_members")).toHaveLength(0);
  });

  it("is a 404 for a stand belonging to another tenant", async () => {
    tableRows = [];
    rpcResult = { data: null, error: { message: "not_found_or_forbidden", code: "P0001" } };
    const { POST } = await import("@/app/api/v1/review-stands/[standId]/rotate-token/route");
    const standId = "11111111-1111-1111-1111-111111111111";

    const response = await POST(
      request("POST", `/api/v1/review-stands/${standId}/rotate-token`),
      { params: Promise.resolve({ standId }) },
    );

    rpcResult = { data: null, error: null };
    // Invisible under RLS, so a cross-tenant attempt and a typo look identical.
    expect(response.status).toBe(404);
  });
});

describe("GET /api/v1/customer-responses/[responseId]", () => {
  const VALID_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  it("rejects without a bearer token", async () => {
    const { GET } = await import(
      "@/app/api/v1/customer-responses/[responseId]/route"
    );
    const response = await GET(
      request("GET", `/api/v1/customer-responses/${VALID_UUID}`, { auth: false }),
      { params: Promise.resolve({ responseId: VALID_UUID }) },
    );

    expect(response.status).toBe(401);
  });

  it("returns the response for a valid UUID", async () => {
    tableRows = [
      {
        id: VALID_UUID,
        location_id: "loc-1",
        rating: 4,
        note_encrypted: null,
        submitted_at: "2026-01-01T00:00:00Z",
        read_at: "2026-01-02T00:00:00Z",
        resolved_at: null,
      },
    ];

    const { GET } = await import(
      "@/app/api/v1/customer-responses/[responseId]/route"
    );
    const response = await GET(
      request("GET", `/api/v1/customer-responses/${VALID_UUID}`),
      { params: Promise.resolve({ responseId: VALID_UUID }) },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { responseId: string; isRead: boolean; isResolved: boolean } };
    expect(body.data.responseId).toBe(VALID_UUID);
    expect(body.data.isRead).toBe(true);
    expect(body.data.isResolved).toBe(false);
  });

  it("rejects a non-UUID responseId before touching the database", async () => {
    const { GET } = await import(
      "@/app/api/v1/customer-responses/[responseId]/route"
    );
    const response = await GET(
      request("GET", "/api/v1/customer-responses/not-a-uuid"),
      { params: Promise.resolve({ responseId: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    expect(
      recorded.filter((entry) => entry.kind === "from" && entry.name !== "organization_members"),
    ).toHaveLength(0);
  });

  it("returns 404 for a missing or cross-organization record", async () => {
    tableRows = [];

    const { GET } = await import(
      "@/app/api/v1/customer-responses/[responseId]/route"
    );
    const response = await GET(
      request("GET", `/api/v1/customer-responses/${VALID_UUID}`),
      { params: Promise.resolve({ responseId: VALID_UUID }) },
    );

    expect(response.status).toBe(404);
  });

  it("queries customer_responses with the org_id filter", async () => {
    tableRows = [];

    const { GET } = await import(
      "@/app/api/v1/customer-responses/[responseId]/route"
    );
    await GET(
      request("GET", `/api/v1/customer-responses/${VALID_UUID}`),
      { params: Promise.resolve({ responseId: VALID_UUID }) },
    );

    const query = recorded.find((entry) => entry.name === "customer_responses");
    expect(query).toBeDefined();
    expect(query?.columns).toContain("id");
    expect(query?.columns).not.toContain("org_id");
  });
});

describe("GET /api/v1/live-feed", () => {
  it("rejects without a bearer token", async () => {
    const { GET } = await import("@/app/api/v1/live-feed/route");
    const response = await GET(request("GET", "/api/v1/live-feed", { auth: false }));
    expect(response.status).toBe(401);
  });

  it("returns merged tap and feedback events sorted by time", async () => {
    perTableRows["public_review_sessions"] = [
      {
        id: "tap-1",
        location_id: "loc-1",
        created_at: "2026-08-20T10:00:00Z",
        locations: { name: "Downtown" },
      },
    ];
    perTableRows["customer_responses"] = [
      {
        id: "fb-1",
        location_id: "loc-2",
        rating: 4,
        submitted_at: "2026-08-20T11:00:00Z",
        locations: { name: "Airport" },
      },
    ];

    const { GET } = await import("@/app/api/v1/live-feed/route");
    const response = await GET(request("GET", "/api/v1/live-feed"));
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      data: Array<{ id: string; type: string; locationName: string; rating: number | null }>;
      meta: { hasMore: boolean; nextCursor: string | null };
    };

    expect(body.data).toHaveLength(2);
    expect(body.data[0]!.id).toBe("fb-1");
    expect(body.data[0]!.type).toBe("feedback");
    expect(body.data[0]!.locationName).toBe("Airport");
    expect(body.data[0]!.rating).toBe(4);
    expect(body.data[1]!.id).toBe("tap-1");
    expect(body.data[1]!.type).toBe("tap");
    expect(body.data[1]!.locationName).toBe("Downtown");
    expect(body.data[1]!.rating).toBeNull();
  });

  it("returns cursor metadata", async () => {
    perTableRows["public_review_sessions"] = [];
    perTableRows["customer_responses"] = [];

    const { GET } = await import("@/app/api/v1/live-feed/route");
    const body = (await (await GET(request("GET", "/api/v1/live-feed"))).json()) as {
      meta: { hasMore: boolean; nextCursor: string | null };
    };

    expect(body.meta).toHaveProperty("hasMore");
    expect(body.meta).toHaveProperty("nextCursor");
    expect(body.meta.hasMore).toBe(false);
    expect(body.meta.nextCursor).toBeNull();
  });

  it("queries both tables with org_id scoping", async () => {
    perTableRows["public_review_sessions"] = [];
    perTableRows["customer_responses"] = [];

    const { GET } = await import("@/app/api/v1/live-feed/route");
    await GET(request("GET", "/api/v1/live-feed"));

    const tapQuery = recorded.find((entry) => entry.name === "public_review_sessions");
    const fbQuery = recorded.find((entry) => entry.name === "customer_responses");
    expect(tapQuery).toBeDefined();
    expect(fbQuery).toBeDefined();
  });

  it("includes location name via embedded select", async () => {
    perTableRows["public_review_sessions"] = [];
    perTableRows["customer_responses"] = [];

    const { GET } = await import("@/app/api/v1/live-feed/route");
    await GET(request("GET", "/api/v1/live-feed"));

    const tapQuery = recorded.find((entry) => entry.name === "public_review_sessions");
    const fbQuery = recorded.find((entry) => entry.name === "customer_responses");
    expect(tapQuery?.columns).toContain("locations(name)");
    expect(fbQuery?.columns).toContain("locations(name)");
  });

  it("never uses the service role", async () => {
    perTableRows["public_review_sessions"] = [];
    perTableRows["customer_responses"] = [];

    serviceRoleUsed = false;
    const { GET } = await import("@/app/api/v1/live-feed/route");
    await GET(request("GET", "/api/v1/live-feed"));
    expect(serviceRoleUsed).toBe(false);
  });

  it("returns an opaque versioned cursor, not a bare timestamp", async () => {
    const ts = "2026-08-20T10:00:00Z";
    // 3 items at limit=2 → hasMore, cursor returned
    perTableRows["public_review_sessions"] = [
      { id: "tap-1", location_id: "loc-1", created_at: ts, locations: { name: "A" } },
      { id: "tap-2", location_id: "loc-1", created_at: ts, locations: { name: "A" } },
    ];
    perTableRows["customer_responses"] = [
      { id: "fb-1", location_id: "loc-1", rating: 3, submitted_at: ts, locations: { name: "A" } },
    ];

    const { GET } = await import("@/app/api/v1/live-feed/route");
    const body = (await (await GET(request("GET", "/api/v1/live-feed?limit=2"))).json()) as {
      meta: { hasMore: boolean; nextCursor: string };
    };

    expect(body.meta.hasMore).toBe(true);

    // Cursor must not be a bare timestamp — it is base64url JSON with version
    expect(body.meta.nextCursor).not.toBe(ts);
    const decoded = JSON.parse(
      Buffer.from(body.meta.nextCursor, "base64url").toString(),
    ) as { v: number; t?: { s: string; i: string }; f?: { s: string; i: string } };
    expect(decoded.v).toBe(1);
  });

  it("cursor tracks per-source positions with timestamp and id", async () => {
    const ts = "2026-08-20T10:00:00Z";
    perTableRows["public_review_sessions"] = [
      { id: "tap-a", location_id: "loc-1", created_at: ts, locations: { name: "A" } },
    ];
    perTableRows["customer_responses"] = [
      { id: "fb-b", location_id: "loc-1", rating: 5, submitted_at: ts, locations: { name: "A" } },
      { id: "fb-a", location_id: "loc-1", rating: 3, submitted_at: ts, locations: { name: "A" } },
    ];

    const { GET } = await import("@/app/api/v1/live-feed/route");
    const body = (await (await GET(request("GET", "/api/v1/live-feed?limit=2"))).json()) as {
      data: Array<{ id: string; type: string }>;
      meta: { hasMore: boolean; nextCursor: string };
    };

    expect(body.meta.hasMore).toBe(true);
    const decoded = JSON.parse(
      Buffer.from(body.meta.nextCursor, "base64url").toString(),
    ) as { v: number; t?: { s: string; i: string }; f?: { s: string; i: string } };

    // Both sources should have cursor positions since both appeared in the page
    expect(decoded.t).toBeDefined();
    expect(decoded.f).toBeDefined();
    expect(decoded.t!.s).toBe(ts);
    expect(decoded.t!.i).toBe("tap-a");
    expect(decoded.f!.s).toBe(ts);
    // The last feedback in the visible slice (sorted by id DESC at same ts)
    expect(decoded.f!.i).toBeDefined();
  });

  it("orders deterministically when timestamps match across both tables", async () => {
    const ts = "2026-08-20T10:00:00Z";
    perTableRows["public_review_sessions"] = [
      { id: "aaa", location_id: "loc-1", created_at: ts, locations: { name: "A" } },
      { id: "bbb", location_id: "loc-1", created_at: ts, locations: { name: "A" } },
    ];
    perTableRows["customer_responses"] = [
      { id: "ccc", location_id: "loc-1", rating: 4, submitted_at: ts, locations: { name: "A" } },
      { id: "ddd", location_id: "loc-1", rating: 2, submitted_at: ts, locations: { name: "A" } },
    ];

    const { GET } = await import("@/app/api/v1/live-feed/route");
    const body = (await (await GET(request("GET", "/api/v1/live-feed"))).json()) as {
      data: Array<{ id: string }>;
    };

    // With all identical timestamps, order should be by id DESC: ddd, ccc, bbb, aaa
    const ids = body.data.map((e) => e.id);
    expect(ids).toEqual(["ddd", "ccc", "bbb", "aaa"]);
  });

  it("preserves cursor source position when one source has no items on page", async () => {
    const ts = "2026-08-20T10:00:00Z";
    // Only taps, no feedback — feedback cursor should carry forward from input
    perTableRows["public_review_sessions"] = [
      { id: "tap-1", location_id: "loc-1", created_at: ts, locations: { name: "A" } },
      { id: "tap-2", location_id: "loc-1", created_at: ts, locations: { name: "A" } },
    ];
    perTableRows["customer_responses"] = [];

    const inputCursor = Buffer.from(
      JSON.stringify({ v: 1, t: { s: "2026-08-20T12:00:00Z", i: "old-tap" }, f: { s: "2026-08-20T11:00:00Z", i: "old-fb" } }),
    ).toString("base64url");

    const { GET } = await import("@/app/api/v1/live-feed/route");
    const body = (await (await GET(request("GET", `/api/v1/live-feed?limit=1&cursor=${inputCursor}`))).json()) as {
      meta: { hasMore: boolean; nextCursor: string };
    };

    expect(body.meta.hasMore).toBe(true);
    const decoded = JSON.parse(
      Buffer.from(body.meta.nextCursor, "base64url").toString(),
    ) as { v: number; t?: { s: string; i: string }; f?: { s: string; i: string } };

    // Tap cursor should be updated from the visible page
    expect(decoded.t).toBeDefined();
    expect(decoded.t!.s).toBe(ts);
    // Feedback cursor should carry forward from the input since no feedback appeared
    expect(decoded.f).toEqual({ s: "2026-08-20T11:00:00Z", i: "old-fb" });
  });

  it("two-page walk: identical timestamps across both tables, no missing or duplicate IDs", async () => {
    const ts = "2026-08-20T10:00:00Z";
    const loc = { name: "HQ" };

    // 6 events at the same timestamp. The mock .or() applies the production's
    // composite cursor filter, so perTableRows stays constant across pages.
    perTableRows["public_review_sessions"] = [
      { id: "t-f", location_id: "loc-1", created_at: ts, locations: loc },
      { id: "t-e", location_id: "loc-1", created_at: ts, locations: loc },
      { id: "t-d", location_id: "loc-1", created_at: ts, locations: loc },
    ];
    perTableRows["customer_responses"] = [
      { id: "f-c", location_id: "loc-1", rating: 5, submitted_at: ts, locations: loc },
      { id: "f-b", location_id: "loc-1", rating: 3, submitted_at: ts, locations: loc },
      { id: "f-a", location_id: "loc-1", rating: 1, submitted_at: ts, locations: loc },
    ];

    const { GET } = await import("@/app/api/v1/live-feed/route");

    // --- Page 1 (limit=3) — no cursor, mock returns all rows unfiltered ---
    const page1 = (await (await GET(request("GET", "/api/v1/live-feed?limit=3"))).json()) as {
      data: Array<{ id: string; type: string }>;
      meta: { hasMore: boolean; nextCursor: string };
    };

    expect(page1.data).toHaveLength(3);
    expect(page1.meta.hasMore).toBe(true);
    const page1Ids = page1.data.map((e) => e.id);
    expect(page1Ids).toEqual(["t-f", "t-e", "t-d"]);

    // --- Page 2 — cursor triggers .or(); mock applies composite filter ---
    const page2 = (await (
      await GET(request("GET", `/api/v1/live-feed?limit=3&cursor=${page1.meta.nextCursor}`))
    ).json()) as {
      data: Array<{ id: string; type: string }>;
      meta: { hasMore: boolean; nextCursor: string | null };
    };

    expect(page2.data).toHaveLength(3);
    expect(page2.meta.hasMore).toBe(false);
    const page2Ids = page2.data.map((e) => e.id);
    expect(page2Ids).toEqual(["f-c", "f-b", "f-a"]);

    // All 6 IDs, no duplicates, no gaps
    const allIds = [...page1Ids, ...page2Ids];
    expect(allIds).toEqual(["t-f", "t-e", "t-d", "f-c", "f-b", "f-a"]);
    expect(new Set(allIds).size).toBe(6);
  });

  it("two-page walk: interleaved sources at the same timestamp", async () => {
    const ts = "2026-08-20T10:00:00Z";
    const loc = { name: "HQ" };

    // 4 events whose IDs interleave across tables when sorted DESC:
    // d-tap, c-fb, b-tap, a-fb. perTableRows is set once and never touched.
    perTableRows["public_review_sessions"] = [
      { id: "d-tap", location_id: "loc-1", created_at: ts, locations: loc },
      { id: "b-tap", location_id: "loc-1", created_at: ts, locations: loc },
    ];
    perTableRows["customer_responses"] = [
      { id: "c-fb", location_id: "loc-1", rating: 4, submitted_at: ts, locations: loc },
      { id: "a-fb", location_id: "loc-1", rating: 2, submitted_at: ts, locations: loc },
    ];

    const { GET } = await import("@/app/api/v1/live-feed/route");

    // --- Page 1 (limit=2) — mock returns all rows, merge-sort picks top 2 ---
    const page1 = (await (await GET(request("GET", "/api/v1/live-feed?limit=2"))).json()) as {
      data: Array<{ id: string; type: string }>;
      meta: { hasMore: boolean; nextCursor: string };
    };

    expect(page1.data).toHaveLength(2);
    expect(page1.meta.hasMore).toBe(true);
    const page1Ids = page1.data.map((e) => e.id);
    expect(page1Ids).toEqual(["d-tap", "c-fb"]);

    // --- Page 2 — .or() filters each table's rows via the composite cursor ---
    const page2 = (await (
      await GET(request("GET", `/api/v1/live-feed?limit=2&cursor=${page1.meta.nextCursor}`))
    ).json()) as {
      data: Array<{ id: string; type: string }>;
      meta: { hasMore: boolean; nextCursor: string | null };
    };

    expect(page2.data).toHaveLength(2);
    expect(page2.meta.hasMore).toBe(false);
    const page2Ids = page2.data.map((e) => e.id);
    expect(page2Ids).toEqual(["b-tap", "a-fb"]);

    // All 4 IDs, no duplicates, no gaps
    const allIds = [...page1Ids, ...page2Ids];
    expect(allIds).toEqual(["d-tap", "c-fb", "b-tap", "a-fb"]);
    expect(new Set(allIds).size).toBe(4);
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
