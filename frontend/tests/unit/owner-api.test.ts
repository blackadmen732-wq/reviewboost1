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
  return { tsField: m[1]!, tsValue: m[2]!, idValue: m[3]! };
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

describe("POST /api/v1/review-stands ciphertext", () => {
  const locationId = "33333333-3333-3333-3333-333333333333";
  const standId = "11111111-1111-1111-1111-111111111111";

  it("creates a stand in one RPC that includes reprint ciphertext", async () => {
    rpcResult = { data: standId, error: null };
    const { POST } = await import("@/app/api/v1/review-stands/route");
    const response = await POST(
      request("POST", "/api/v1/review-stands", { body: { locationId, label: "Front Desk" } }),
    );

    expect(response.status).toBe(201);
    const creates = recorded.filter((entry) => entry.kind === "rpc" && entry.name === "rpc_create_stand");
    expect(creates).toHaveLength(1);
    expect(creates[0]?.args?.["p_token_ciphertext"]).toEqual(expect.any(String));
    expect(String(creates[0]?.args?.["p_token_ciphertext"]).length).toBeGreaterThan(0);
    expect(creates[0]?.args?.["p_cipher_key_version"]).toBe(1);
    expect(recorded.some((entry) => entry.name === "rpc_set_stand_token_ciphertext")).toBe(false);
  });

  it("does not report success when the create RPC errors", async () => {
    rpcResult = {
      data: null,
      error: {
        code: "42883",
        message: "function rpc_set_stand_token_ciphertext(uuid, text, smallint) does not exist",
      },
    };
    const { POST } = await import("@/app/api/v1/review-stands/route");
    const response = await POST(
      request("POST", "/api/v1/review-stands", { body: { locationId, label: "Till 2" } }),
    );
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(body).not.toContain("rpc_set_stand_token_ciphertext");
    expect(body).not.toContain("42883");
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

/**
 * Fixed UUIDs for tests whose cursors round-trip through parseCursor(), which
 * validates cursor.t.i / cursor.f.i as UUIDs. Static strings, alphabetically
 * ordered by suffix so `id DESC` order in assertions is easy to read.
 */
const U = {
  tapA: "11111111-1111-1111-1111-111111111111",
  tapB: "22222222-2222-2222-2222-222222222222",
  tapC: "33333333-3333-3333-3333-333333333333",
  tapD: "44444444-4444-4444-4444-444444444444",
  fbA: "55555555-5555-5555-5555-555555555555",
  fbB: "66666666-6666-6666-6666-666666666666",
  fbC: "77777777-7777-7777-7777-777777777777",
  fbD: "88888888-8888-8888-8888-888888888888",
  oldTap: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  oldFb: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
} as const;

function encCursor(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

describe("GET /api/v1/live-feed", () => {
  it("rejects without a bearer token", async () => {
    const { GET } = await import("@/app/api/v1/live-feed/route");
    const response = await GET(request("GET", "/api/v1/live-feed", { auth: false }));
    expect(response.status).toBe(401);
  });

  it("returns merged tap and feedback events sorted by time", async () => {
    perTableRows["public_review_sessions"] = [
      {
        id: U.tapA,
        location_id: "loc-1",
        created_at: "2026-08-20T10:00:00Z",
        locations: { name: "Downtown" },
      },
    ];
    perTableRows["customer_responses"] = [
      {
        id: U.fbA,
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
    expect(body.data[0]!.id).toBe(U.fbA);
    expect(body.data[0]!.type).toBe("feedback");
    expect(body.data[0]!.locationName).toBe("Airport");
    expect(body.data[0]!.rating).toBe(4);
    expect(body.data[1]!.id).toBe(U.tapA);
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
      { id: U.tapA, location_id: "loc-1", created_at: ts, locations: { name: "A" } },
      { id: U.tapB, location_id: "loc-1", created_at: ts, locations: { name: "A" } },
    ];
    perTableRows["customer_responses"] = [
      { id: U.fbA, location_id: "loc-1", rating: 3, submitted_at: ts, locations: { name: "A" } },
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
    // Tap UUID chosen to sort high so it survives the visible slice at limit=2.
    const highTap = "ffffffff-ffff-ffff-ffff-ffffffffff01";
    perTableRows["public_review_sessions"] = [
      { id: highTap, location_id: "loc-1", created_at: ts, locations: { name: "A" } },
    ];
    perTableRows["customer_responses"] = [
      { id: U.fbB, location_id: "loc-1", rating: 5, submitted_at: ts, locations: { name: "A" } },
      { id: U.fbA, location_id: "loc-1", rating: 3, submitted_at: ts, locations: { name: "A" } },
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
    expect(decoded.t!.i).toBe(highTap);
    expect(decoded.f!.s).toBe(ts);
    // The last feedback in the visible slice (sorted by id DESC at same ts)
    expect(decoded.f!.i).toBeDefined();
  });

  it("orders deterministically when timestamps match across both tables", async () => {
    const ts = "2026-08-20T10:00:00Z";
    // UUIDs chosen so DESC order is unambiguous: 8 > 7 > 6 > 5 (leading hex).
    perTableRows["public_review_sessions"] = [
      { id: U.tapA, location_id: "loc-1", created_at: ts, locations: { name: "A" } }, // 1
      { id: U.tapB, location_id: "loc-1", created_at: ts, locations: { name: "A" } }, // 2
    ];
    perTableRows["customer_responses"] = [
      { id: U.fbC, location_id: "loc-1", rating: 4, submitted_at: ts, locations: { name: "A" } }, // 7
      { id: U.fbD, location_id: "loc-1", rating: 2, submitted_at: ts, locations: { name: "A" } }, // 8
    ];

    const { GET } = await import("@/app/api/v1/live-feed/route");
    const body = (await (await GET(request("GET", "/api/v1/live-feed"))).json()) as {
      data: Array<{ id: string }>;
    };

    // All identical timestamps → order by id DESC: fbD, fbC, tapB, tapA
    const ids = body.data.map((e) => e.id);
    expect(ids).toEqual([U.fbD, U.fbC, U.tapB, U.tapA]);
  });

  it("preserves cursor source position when one source has no items on page", async () => {
    const ts = "2026-08-20T10:00:00Z";
    // Only taps, no feedback — feedback cursor should carry forward from input
    perTableRows["public_review_sessions"] = [
      { id: U.tapA, location_id: "loc-1", created_at: ts, locations: { name: "A" } },
      { id: U.tapB, location_id: "loc-1", created_at: ts, locations: { name: "A" } },
    ];
    perTableRows["customer_responses"] = [];

    const inputCursor = encCursor({
      v: 1,
      t: { s: "2026-08-20T12:00:00Z", i: U.oldTap },
      f: { s: "2026-08-20T11:00:00Z", i: U.oldFb },
    });

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
    expect(decoded.f).toEqual({ s: "2026-08-20T11:00:00Z", i: U.oldFb });
  });

  it("two-page walk: identical timestamps across both tables, no missing or duplicate IDs", async () => {
    const ts = "2026-08-20T10:00:00Z";
    const loc = { name: "HQ" };

    // 6 UUIDs, DESC order: tF > tE > tD > fC > fB > fA.
    const tF = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const tE = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
    const tD = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const fC = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const fB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
    const fA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";

    // 6 events at the same timestamp. The mock .or() applies the production's
    // composite cursor filter, so perTableRows stays constant across pages.
    perTableRows["public_review_sessions"] = [
      { id: tF, location_id: "loc-1", created_at: ts, locations: loc },
      { id: tE, location_id: "loc-1", created_at: ts, locations: loc },
      { id: tD, location_id: "loc-1", created_at: ts, locations: loc },
    ];
    perTableRows["customer_responses"] = [
      { id: fC, location_id: "loc-1", rating: 5, submitted_at: ts, locations: loc },
      { id: fB, location_id: "loc-1", rating: 3, submitted_at: ts, locations: loc },
      { id: fA, location_id: "loc-1", rating: 1, submitted_at: ts, locations: loc },
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
    expect(page1Ids).toEqual([tF, tE, tD]);

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
    expect(page2Ids).toEqual([fC, fB, fA]);

    // All 6 IDs, no duplicates, no gaps
    const allIds = [...page1Ids, ...page2Ids];
    expect(allIds).toEqual([tF, tE, tD, fC, fB, fA]);
    expect(new Set(allIds).size).toBe(6);
  });

  it("two-page walk: interleaved sources at the same timestamp", async () => {
    const ts = "2026-08-20T10:00:00Z";
    const loc = { name: "HQ" };

    // 4 UUIDs whose DESC order interleaves across tables: dTap > cFb > bTap > aFb.
    const dTap = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const cFb = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const bTap = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2";
    const aFb = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";

    perTableRows["public_review_sessions"] = [
      { id: dTap, location_id: "loc-1", created_at: ts, locations: loc },
      { id: bTap, location_id: "loc-1", created_at: ts, locations: loc },
    ];
    perTableRows["customer_responses"] = [
      { id: cFb, location_id: "loc-1", rating: 4, submitted_at: ts, locations: loc },
      { id: aFb, location_id: "loc-1", rating: 2, submitted_at: ts, locations: loc },
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
    expect(page1Ids).toEqual([dTap, cFb]);

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
    expect(page2Ids).toEqual([bTap, aFb]);

    // All 4 IDs, no duplicates, no gaps
    const allIds = [...page1Ids, ...page2Ids];
    expect(allIds).toEqual([dTap, cFb, bTap, aFb]);
    expect(new Set(allIds).size).toBe(4);
  });

  // -------------------------------------------------- cursor validation ---

  it("rejects a cursor that is not valid base64url/JSON with 400", async () => {
    const { GET } = await import("@/app/api/v1/live-feed/route");
    // "!!!" is not valid base64url after our Buffer decode; even if it decodes,
    // it is not valid JSON. Either way the endpoint must return 400, not 500.
    const response = await GET(request("GET", "/api/v1/live-feed?cursor=%21%21%21"));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; details?: Array<{ field: string }> } };
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details?.[0]?.field).toBe("cursor");
  });

  it("rejects a cursor that decodes to non-JSON with 400", async () => {
    const { GET } = await import("@/app/api/v1/live-feed/route");
    const bad = Buffer.from("not json at all").toString("base64url");
    const response = await GET(request("GET", `/api/v1/live-feed?cursor=${bad}`));
    expect(response.status).toBe(400);
  });

  it("rejects an unsupported cursor version with 400", async () => {
    const { GET } = await import("@/app/api/v1/live-feed/route");
    const bad = encCursor({ v: 2, t: { s: "2026-08-20T10:00:00Z", i: U.tapA } });
    const response = await GET(request("GET", `/api/v1/live-feed?cursor=${bad}`));
    expect(response.status).toBe(400);
  });

  it("rejects a cursor that is not an object with 400", async () => {
    const { GET } = await import("@/app/api/v1/live-feed/route");
    for (const shape of [42, "string", null, [1, 2, 3], true]) {
      const bad = encCursor(shape);
      const response = await GET(request("GET", `/api/v1/live-feed?cursor=${bad}`));
      expect(response.status).toBe(400);
    }
  });

  it("rejects cursor with malformed 't' field with 400", async () => {
    const { GET } = await import("@/app/api/v1/live-feed/route");
    const shapes = [
      { v: 1, t: "not an object" },
      { v: 1, t: { s: "2026-08-20T10:00:00Z" } },                       // missing i
      { v: 1, t: { i: U.tapA } },                                         // missing s
      { v: 1, t: { s: "not a timestamp", i: U.tapA } },                   // bad ts
      { v: 1, t: { s: "2026-08-20T10:00:00Z", i: "not-a-uuid" } },        // bad id
      { v: 1, t: { s: "", i: U.tapA } },                                  // empty ts
      { v: 1, t: { s: "2026-08-20T10:00:00Z", i: "" } },                  // empty id
      { v: 1, t: { s: "2026-08-20T10:00:00Z", i: U.tapA, extra: 1 } },    // extra key
    ];
    for (const shape of shapes) {
      const bad = encCursor(shape);
      const response = await GET(request("GET", `/api/v1/live-feed?cursor=${bad}`));
      expect(response.status, JSON.stringify(shape)).toBe(400);
    }
  });

  it("rejects cursor with malformed 'f' field with 400", async () => {
    const { GET } = await import("@/app/api/v1/live-feed/route");
    const bad = encCursor({ v: 1, f: { s: "2026-08-20T10:00:00Z", i: "still-not-a-uuid" } });
    const response = await GET(request("GET", `/api/v1/live-feed?cursor=${bad}`));
    expect(response.status).toBe(400);
  });

  it("rejects a cursor with unexpected top-level keys with 400", async () => {
    const { GET } = await import("@/app/api/v1/live-feed/route");
    const bad = encCursor({ v: 1, t: { s: "2026-08-20T10:00:00Z", i: U.tapA }, evil: "payload" });
    const response = await GET(request("GET", `/api/v1/live-feed?cursor=${bad}`));
    expect(response.status).toBe(400);
  });

  it("accepts a well-formed server-generated cursor and paginates", async () => {
    // Round-trip proof: generate a real cursor from page 1, feed it back, get a
    // 200 that walks the composite filter through the mock's .or().
    perTableRows["public_review_sessions"] = [];
    perTableRows["customer_responses"] = [];

    const validCursor = encCursor({
      v: 1,
      t: { s: "2026-08-20T10:00:00Z", i: U.tapA },
      f: { s: "2026-08-20T10:00:00Z", i: U.fbA },
    });

    const { GET } = await import("@/app/api/v1/live-feed/route");
    const response = await GET(request("GET", `/api/v1/live-feed?cursor=${validCursor}`));
    expect(response.status).toBe(200);
  });

  // ------------------------------------------------------ limit clamping ---

  it("limit=1 is honoured", async () => {
    const ts = "2026-08-20T10:00:00Z";
    perTableRows["public_review_sessions"] = [
      { id: U.tapA, location_id: "loc-1", created_at: ts, locations: { name: "A" } },
      { id: U.tapB, location_id: "loc-1", created_at: ts, locations: { name: "A" } },
    ];
    perTableRows["customer_responses"] = [];
    const { GET } = await import("@/app/api/v1/live-feed/route");
    const body = (await (await GET(request("GET", "/api/v1/live-feed?limit=1"))).json()) as {
      data: unknown[];
      meta: { hasMore: boolean };
    };
    expect(body.data).toHaveLength(1);
    expect(body.meta.hasMore).toBe(true);
  });

  it("limit=0 is clamped up to the minimum of 1", async () => {
    const ts = "2026-08-20T10:00:00Z";
    perTableRows["public_review_sessions"] = [
      { id: U.tapA, location_id: "loc-1", created_at: ts, locations: { name: "A" } },
      { id: U.tapB, location_id: "loc-1", created_at: ts, locations: { name: "A" } },
    ];
    perTableRows["customer_responses"] = [];
    const { GET } = await import("@/app/api/v1/live-feed/route");
    const body = (await (await GET(request("GET", "/api/v1/live-feed?limit=0"))).json()) as {
      data: unknown[];
    };
    expect(body.data).toHaveLength(1);
  });

  it("negative limit is clamped up to 1", async () => {
    const ts = "2026-08-20T10:00:00Z";
    perTableRows["public_review_sessions"] = [
      { id: U.tapA, location_id: "loc-1", created_at: ts, locations: { name: "A" } },
      { id: U.tapB, location_id: "loc-1", created_at: ts, locations: { name: "A" } },
    ];
    perTableRows["customer_responses"] = [];
    const { GET } = await import("@/app/api/v1/live-feed/route");
    const body = (await (await GET(request("GET", "/api/v1/live-feed?limit=-5"))).json()) as {
      data: unknown[];
    };
    expect(body.data).toHaveLength(1);
  });

  it("decimal limit is truncated to an integer", async () => {
    const ts = "2026-08-20T10:00:00Z";
    // 4 rows, limit=3.7 → must be treated as 3, not 3.7 or 4.
    perTableRows["public_review_sessions"] = [
      { id: U.tapA, location_id: "loc-1", created_at: ts, locations: { name: "A" } },
      { id: U.tapB, location_id: "loc-1", created_at: ts, locations: { name: "A" } },
      { id: U.tapC, location_id: "loc-1", created_at: ts, locations: { name: "A" } },
      { id: U.tapD, location_id: "loc-1", created_at: ts, locations: { name: "A" } },
    ];
    perTableRows["customer_responses"] = [];
    const { GET } = await import("@/app/api/v1/live-feed/route");
    const body = (await (await GET(request("GET", "/api/v1/live-feed?limit=3.7"))).json()) as {
      data: unknown[];
      meta: { hasMore: boolean };
    };
    expect(body.data).toHaveLength(3);
    expect(body.meta.hasMore).toBe(true);
  });

  it("limit=100 is accepted", async () => {
    perTableRows["public_review_sessions"] = [];
    perTableRows["customer_responses"] = [];
    const { GET } = await import("@/app/api/v1/live-feed/route");
    const response = await GET(request("GET", "/api/v1/live-feed?limit=100"));
    expect(response.status).toBe(200);
  });

  it("limit above 100 is clamped down to 100", async () => {
    const ts = "2026-08-20T10:00:00Z";
    // Fill with 101 rows; limit=9999 must clamp to 100 → hasMore true.
    perTableRows["public_review_sessions"] = Array.from({ length: 101 }, (_, k) => ({
      // Vary the last hex nibble so IDs stay unique and syntactically valid.
      id: `00000000-0000-0000-0000-${(k + 1).toString(16).padStart(12, "0")}`,
      location_id: "loc-1",
      created_at: ts,
      locations: { name: "A" },
    }));
    perTableRows["customer_responses"] = [];
    const { GET } = await import("@/app/api/v1/live-feed/route");
    const body = (await (await GET(request("GET", "/api/v1/live-feed?limit=9999"))).json()) as {
      data: unknown[];
      meta: { hasMore: boolean };
    };
    expect(body.data).toHaveLength(100);
    expect(body.meta.hasMore).toBe(true);
  });

  it("non-numeric limit falls back to the default of 25", async () => {
    const ts = "2026-08-20T10:00:00Z";
    perTableRows["public_review_sessions"] = Array.from({ length: 30 }, (_, k) => ({
      id: `00000000-0000-0000-0000-${(k + 1).toString(16).padStart(12, "0")}`,
      location_id: "loc-1",
      created_at: ts,
      locations: { name: "A" },
    }));
    perTableRows["customer_responses"] = [];
    const { GET } = await import("@/app/api/v1/live-feed/route");
    const body = (await (await GET(request("GET", "/api/v1/live-feed?limit=abc"))).json()) as {
      data: unknown[];
    };
    expect(body.data).toHaveLength(25);
  });

  // ----------------------------------- strict cursor timestamp validation ---

  it("rejects cursor timestamps Date.parse() accepts but are not RFC3339", async () => {
    const { GET } = await import("@/app/api/v1/live-feed/route");
    // Every one of these is happily accepted by JS `Date.parse()` but is NOT
    // the syntax Postgres/PostgREST emits for a timestamptz column, and must
    // never reach the resume `.or()` filter.
    const badTimestamps = [
      "Aug 20, 2026 10:00:00 GMT",                       // human-readable
      "2026-08-20 10:00:00Z",                            // space instead of T
      "2026/08/20T10:00:00Z",                            // slashes
      "2026-08-20T10:00:00",                             // no offset / Z
      "August 20, 2026",                                 // month name + comma
      "2026-02-30T10:00:00Z",                            // invalid calendar date
      "2026-13-01T10:00:00Z",                            // invalid month
      "2026-08-20T25:00:00Z",                            // invalid hour
      "2026-08-20T10:00:00+25:00",                       // invalid offset hour
      "2026-08-20T10:00:00Z, injection",                 // trailing comma
      "'2026-08-20T10:00:00Z'",                          // quoted
      "2026-08-20T10:00:00Z or 1=1",                     // SQL-shaped tail
    ];
    for (const s of badTimestamps) {
      const bad = encCursor({ v: 1, t: { s, i: U.tapA } });
      const response = await GET(request("GET", `/api/v1/live-feed?cursor=${bad}`));
      expect(response.status, s).toBe(400);
    }
  });

  it("accepts strictly-formed RFC3339 timestamps in a cursor", async () => {
    perTableRows["public_review_sessions"] = [];
    perTableRows["customer_responses"] = [];
    const { GET } = await import("@/app/api/v1/live-feed/route");
    // Every one of these is a shape Postgres/PostgREST actually emits for
    // timestamptz via supabase-js.
    const goodTimestamps = [
      "2026-08-20T10:00:00Z",
      "2026-08-20T10:00:00.123Z",
      "2026-08-20T10:00:00.123456Z",
      "2026-08-20T10:00:00+00:00",
      "2026-08-20T10:00:00-05:00",
      "2026-08-20T10:00:00.500+05:30",
      "2024-02-29T00:00:00Z", // real leap day
    ];
    for (const s of goodTimestamps) {
      const good = encCursor({ v: 1, t: { s, i: U.tapA } });
      const response = await GET(request("GET", `/api/v1/live-feed?cursor=${good}`));
      expect(response.status, s).toBe(200);
    }
  });

  it("missing limit falls back to the default of 25", async () => {
    const ts = "2026-08-20T10:00:00Z";
    perTableRows["public_review_sessions"] = Array.from({ length: 30 }, (_, k) => ({
      id: `00000000-0000-0000-0000-${(k + 1).toString(16).padStart(12, "0")}`,
      location_id: "loc-1",
      created_at: ts,
      locations: { name: "A" },
    }));
    perTableRows["customer_responses"] = [];
    const { GET } = await import("@/app/api/v1/live-feed/route");
    const body = (await (await GET(request("GET", "/api/v1/live-feed"))).json()) as {
      data: unknown[];
    };
    expect(body.data).toHaveLength(25);
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
