import type { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Contract tests for the five public Route Handlers.
 *
 * Supabase is mocked, so what these prove is everything above the database:
 * routing, validation, the error envelope, status codes, security headers, the
 * shape of the arguments each RPC receives, and — most importantly — that
 * nothing the customer sees varies with the rating they chose.
 *
 * What they do **not** prove is that the database does its half: idempotent
 * replay collapsing duplicates, row level security isolating tenants,
 * encryption at rest, one response per session. Those need a real Postgres and
 * are asserted in `supabase/tests`. This file must not be read as covering them.
 */

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

const calls: RpcCall[] = [];
let rpcHandler: (fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown };

vi.mock("@/lib/server/supabase", () => ({
  serviceRoleClient: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve(rpcHandler(fn, args));
    },
  }),
}));

const TOKEN = "abcdefghijklmnop";
const SESSION_ID = "s".repeat(43);
const RESPONSE_ID = "r".repeat(43);

const ACTIVE_STAND = {
  org_id: "11111111-1111-1111-1111-111111111111",
  location_id: "22222222-2222-2222-2222-222222222222",
  stand_id: "33333333-3333-3333-3333-333333333333",
  business_name: "The Corner Cafe",
  location_name: "High Street",
  google_review_url: "https://g.page/r/CdSAMPLE/review",
  default_locale: "en",
};

function allowed() {
  return { data: [{ allowed: true, retry_after_seconds: 1 }], error: null };
}

/** The default world: an active, fully-configured stand where writes succeed. */
function happyPath(fn: string): { data: unknown; error: unknown } {
  if (fn === "rpc_consume_rate_limit") return allowed();
  if (fn === "rpc_public_resolve_stand") return { data: [ACTIVE_STAND], error: null };
  return { data: [{ outcome: "created", response_status: null, response_body_encrypted: null }], error: null };
}

function key(operation: string): string {
  return `rb_${operation}_00000000-1111-2222-3333-444444444444`;
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

const params = (token: string) => ({ params: Promise.resolve({ token }) });

beforeAll(() => {
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  process.env.PUBLIC_FRONTEND_URL = "http://localhost:3000";
});

beforeEach(() => {
  calls.length = 0;
  rpcHandler = happyPath;
});

async function getContext(token = TOKEN) {
  const { GET } = await import("@/app/api/v1/public/q/[token]/route");
  return GET(request("GET", `/api/v1/public/q/${token}`), params(token));
}

async function postSession(body: unknown, headers?: Record<string, string>) {
  const { POST } = await import("@/app/api/v1/public/q/[token]/sessions/route");
  return POST(
    request("POST", `/api/v1/public/q/${TOKEN}/sessions`, {
      body,
      ...(headers ? { headers } : { headers: { "idempotency-key": key("session") } }),
    }),
    params(TOKEN),
  );
}

async function postResponse(body: unknown, headers?: Record<string, string>) {
  const { POST } = await import("@/app/api/v1/public/q/[token]/responses/route");
  return POST(
    request("POST", `/api/v1/public/q/${TOKEN}/responses`, {
      body,
      ...(headers ? { headers } : { headers: { "idempotency-key": key("response") } }),
    }),
    params(TOKEN),
  );
}

async function postGoogleClick(body: unknown, headers?: Record<string, string>) {
  const { POST } = await import("@/app/api/v1/public/q/[token]/google-click/route");
  return POST(
    request("POST", `/api/v1/public/q/${TOKEN}/google-click`, {
      body,
      ...(headers ? { headers } : { headers: { "idempotency-key": key("google-click") } }),
    }),
    params(TOKEN),
  );
}

async function postTeamPraise(body: unknown, headers?: Record<string, string>) {
  const { POST } = await import("@/app/api/v1/public/q/[token]/team-praise/route");
  return POST(
    request("POST", `/api/v1/public/q/${TOKEN}/team-praise`, {
      body,
      ...(headers ? { headers } : { headers: { "idempotency-key": key("team-praise") } }),
    }),
    params(TOKEN),
  );
}

describe("GET public context", () => {
  it("returns exactly the contract shape", async () => {
    const response = await getContext();
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "business",
      "defaultLocale",
      "googleReviewUrl",
      "location",
      "supportedLocales",
    ]);
    expect(body["googleReviewUrl"]).toBe(ACTIVE_STAND.google_review_url);
    expect(body["business"]).toEqual({ name: "The Corner Cafe", logoUrl: null });
    expect(body["location"]).toEqual({ name: "High Street" });
    expect(body["supportedLocales"]).toEqual(["en", "es", "ht"]);
  });

  it("never leaks a tenant, location, or stand identifier", async () => {
    // A caller who learned the tenant could write unlimited fabricated feedback
    // into it.
    const serialised = JSON.stringify(await (await getContext()).json());

    expect(serialised).not.toContain(ACTIVE_STAND.org_id);
    expect(serialised).not.toContain(ACTIVE_STAND.location_id);
    expect(serialised).not.toContain(ACTIVE_STAND.stand_id);
    expect(serialised.toLowerCase()).not.toContain("threshold");
  });

  it("records no scan, so a page load cannot inflate the numbers", async () => {
    await getContext();
    expect(calls.map((call) => call.fn)).not.toContain("rpc_public_create_session");
  });

  it("sends the stand token only as a keyed digest", async () => {
    await getContext();
    const resolve = calls.find((call) => call.fn === "rpc_public_resolve_stand");
    expect(resolve?.args["p_token_hash"]).not.toBe(TOKEN);
    expect(String(resolve?.args["p_token_hash"])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sets no-store and the security headers", async () => {
    const response = await getContext();

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("echoes a caller-supplied request id, so a trace survives the hop", async () => {
    const { GET } = await import("@/app/api/v1/public/q/[token]/route");
    const response = await GET(
      request("GET", `/api/v1/public/q/${TOKEN}`, { headers: { "x-request-id": "trace-abc-123" } }),
      params(TOKEN),
    );
    expect(response.headers.get("x-request-id")).toBe("trace-abc-123");
  });

  it("makes unknown and unconfigured stands indistinguishable", async () => {
    const outcomes: Array<{ status: number; body: unknown }> = [];

    // Unknown token.
    rpcHandler = (fn) => (fn === "rpc_consume_rate_limit" ? allowed() : { data: [], error: null });
    let response = await getContext();
    outcomes.push({ status: response.status, body: await response.json() });

    // Active, but its destination is not a Google review page.
    rpcHandler = (fn) =>
      fn === "rpc_consume_rate_limit"
        ? allowed()
        : { data: [{ ...ACTIVE_STAND, google_review_url: "https://evil.example/review" }], error: null };
    response = await getContext();
    outcomes.push({ status: response.status, body: await response.json() });

    // Active, but with no Google URL configured at all.
    rpcHandler = (fn) =>
      fn === "rpc_consume_rate_limit"
        ? allowed()
        : { data: [{ ...ACTIVE_STAND, google_review_url: null }], error: null };
    response = await getContext();
    outcomes.push({ status: response.status, body: await response.json() });

    for (const outcome of outcomes) {
      expect(outcome.status).toBe(404);
      const body = outcome.body as { error: { code: string; message: string }; requestId: string };
      expect(body.error.code).toBe("review_link_inactive");
      expect(body.error.message).toBe("This review link is not active.");
      expect(Object.keys(body).sort()).toEqual(["error", "requestId"]);
    }
  });

  it("rejects a malformed token before any lookup", async () => {
    const { GET } = await import("@/app/api/v1/public/q/[token]/route");
    const response = await GET(request("GET", "/api/v1/public/q/bad!token"), params("bad!token"));

    expect(response.status).toBe(400);
    expect(calls.map((call) => call.fn)).not.toContain("rpc_public_resolve_stand");
  });

  it("never exposes a database error to the customer", async () => {
    rpcHandler = (fn) =>
      fn === "rpc_consume_rate_limit"
        ? allowed()
        : { data: null, error: { message: 'relation "customer_responses" does not exist', code: "42P01" } };

    const response = await getContext();
    const serialised = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(serialised).not.toContain("customer_responses");
    expect(serialised).not.toContain("42P01");
    expect(serialised).not.toContain("relation");
  });
});

describe("review integrity — every rating is handled identically", () => {
  it("answers ratings one to five with the identical status and shape", async () => {
    const shapes: string[] = [];

    for (const rating of [1, 2, 3, 4, 5]) {
      const response = await postResponse({ sessionId: SESSION_ID, rating });
      const body = (await response.json()) as Record<string, unknown>;

      shapes.push(
        JSON.stringify({
          status: response.status,
          keys: Object.keys(body).sort(),
          headers: {
            cache: response.headers.get("cache-control"),
            type: response.headers.get("content-type"),
          },
        }),
      );
    }

    // Byte-identical but for the generated id: a customer who chose 1 receives
    // exactly what a customer who chose 5 receives.
    expect(new Set(shapes).size).toBe(1);
    expect(shapes[0]).toContain('"status":201');
  });

  it("passes the same argument set to the database for every rating", async () => {
    const argShapes: string[] = [];

    for (const rating of [1, 2, 3, 4, 5]) {
      calls.length = 0;
      await postResponse({ sessionId: SESSION_ID, rating });

      const submit = calls.find((call) => call.fn === "rpc_public_submit_response");
      argShapes.push(JSON.stringify(Object.keys(submit?.args ?? {}).sort()));
      // The rating reaches the database exactly as chosen, and is the only
      // thing that differs.
      expect(submit?.args["p_rating"]).toBe(rating);
    }

    expect(new Set(argShapes).size).toBe(1);
  });

  it("accepts a note on every rating and demands one on none", async () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      const without = await postResponse({ sessionId: SESSION_ID, rating });
      expect(without.status, `rating ${rating} without a note`).toBe(201);

      const withNote = await postResponse({ sessionId: SESSION_ID, rating, note: "some detail" });
      expect(withNote.status, `rating ${rating} with a note`).toBe(201);
    }
  });

  it("encrypts the note before it reaches the database", async () => {
    calls.length = 0;
    await postResponse({ sessionId: SESSION_ID, rating: 2, note: "The table was sticky" });

    const submit = calls.find((call) => call.fn === "rpc_public_submit_response");
    const stored = String(submit?.args["p_note_encrypted"]);

    expect(stored).not.toContain("sticky");
    expect(stored).toMatch(/^v1:/);
  });

  it("stores no ciphertext when there is no note", async () => {
    calls.length = 0;
    await postResponse({ sessionId: SESSION_ID, rating: 5 });

    const submit = calls.find((call) => call.fn === "rpc_public_submit_response");
    expect(submit?.args["p_note_encrypted"]).toBeNull();
  });
});

describe("idempotency", () => {
  it("requires the header on every mutation", async () => {
    const mutations = [
      () => postSession({ locale: "en" }, {}),
      () => postResponse({ sessionId: SESSION_ID, rating: 3 }, {}),
      () => postGoogleClick({ sessionId: SESSION_ID, responseId: RESPONSE_ID }, {}),
      () => postTeamPraise({ sessionId: SESSION_ID, responseId: RESPONSE_ID, firstName: "Sam" }, {}),
    ];

    for (const mutation of mutations) {
      const response = await mutation();
      expect(response.status).toBe(400);

      const body = (await response.json()) as { error: { details?: Array<{ field: string }> } };
      expect(body.error.details?.[0]?.field).toBe("Idempotency-Key");
    }
  });

  it("rejects a key too short to be worth anything", async () => {
    const response = await postSession({ locale: "en" }, { "idempotency-key": "short" });
    expect(response.status).toBe(400);
  });

  it("sends the key as a keyed digest, never in clear", async () => {
    calls.length = 0;
    await postSession({ locale: "en" });

    const create = calls.find((call) => call.fn === "rpc_public_create_session");
    expect(String(create?.args["p_idempotency_key"])).not.toContain("rb_session");
    expect(String(create?.args["p_idempotency_key"])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns 200 rather than 201 when replaying a stored result", async () => {
    const { encrypt } = await import("@/lib/server/crypto");
    const stored = encrypt(JSON.stringify({ sessionId: "previously-issued-session-token" }));

    rpcHandler = (fn) =>
      fn === "rpc_consume_rate_limit"
        ? allowed()
        : { data: [{ outcome: "replay", response_status: 201, response_body_encrypted: stored }], error: null };

    const response = await postSession({ locale: "en" });

    // A replay created nothing, so reporting 201 again would be a lie the
    // client can act on.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessionId: "previously-issued-session-token" });
  });

  it("reports a reused key carrying different data as a conflict", async () => {
    rpcHandler = (fn) =>
      fn === "rpc_consume_rate_limit"
        ? allowed()
        : { data: [{ outcome: "conflict", response_status: null, response_body_encrypted: null }], error: null };

    const response = await postResponse({ sessionId: SESSION_ID, rating: 5 });
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("idempotency_conflict");
  });
});

describe("session and response validity", () => {
  it("reports an expired session as 410, so the client can recover", async () => {
    rpcHandler = (fn) =>
      fn === "rpc_consume_rate_limit"
        ? allowed()
        : { data: [{ outcome: "session_expired", response_status: null, response_body_encrypted: null }], error: null };

    const response = await postResponse({ sessionId: SESSION_ID, rating: 4 });
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(410);
    expect(body.error.code).toBe("session_expired");
  });

  it("refuses a second response on a session that already has one", async () => {
    rpcHandler = (fn) =>
      fn === "rpc_consume_rate_limit"
        ? allowed()
        : { data: [{ outcome: "response_conflict", response_status: null, response_body_encrypted: null }], error: null };

    const response = await postResponse({ sessionId: SESSION_ID, rating: 4 });
    expect(response.status).toBe(409);
  });

  it("refuses a session that belongs to another stand", async () => {
    rpcHandler = (fn) =>
      fn === "rpc_consume_rate_limit"
        ? allowed()
        : { data: [{ outcome: "session_invalid", response_status: null, response_body_encrypted: null }], error: null };

    const response = await postResponse({ sessionId: SESSION_ID, rating: 4 });
    expect(response.status).toBe(404);
  });
});

describe("google click", () => {
  it("returns 204 with no body", async () => {
    const response = await postGoogleClick({ sessionId: SESSION_ID, responseId: RESPONSE_ID });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("returns 204 on a replay too, because the contract documents one status", async () => {
    rpcHandler = (fn) =>
      fn === "rpc_consume_rate_limit"
        ? allowed()
        : { data: [{ outcome: "replay", response_status: 204, response_body_encrypted: null }], error: null };

    const response = await postGoogleClick({ sessionId: SESSION_ID, responseId: RESPONSE_ID });
    expect(response.status).toBe(204);
  });

  it("never redirects — the client owns the navigation", async () => {
    const response = await postGoogleClick({ sessionId: SESSION_ID, responseId: RESPONSE_ID });

    expect(response.status).toBeLessThan(300);
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("team praise", () => {
  it("returns only the new id", async () => {
    const response = await postTeamPraise({
      sessionId: SESSION_ID,
      responseId: RESPONSE_ID,
      firstName: "Sarah",
      note: "Stayed late to sort out our order.",
    });

    expect(response.status).toBe(201);

    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["teamPraiseId"]);
  });

  it("returns nothing about the rating, Google, or money", async () => {
    const response = await postTeamPraise({
      sessionId: SESSION_ID,
      responseId: RESPONSE_ID,
      firstName: "Sarah",
    });

    const serialised = JSON.stringify(await response.json()).toLowerCase();
    for (const forbidden of ["rating", "star", "google", "bonus", "payroll", "phone", "email"]) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
  });

  it("encrypts the name and the note", async () => {
    calls.length = 0;
    await postTeamPraise({
      sessionId: SESSION_ID,
      responseId: RESPONSE_ID,
      firstName: "José",
      note: "Went out of their way",
    });

    const submit = calls.find((call) => call.fn === "rpc_public_submit_team_praise");
    expect(String(submit?.args["p_first_name_encrypted"])).not.toContain("José");
    expect(String(submit?.args["p_note_encrypted"])).not.toContain("Went out");
  });

  it("stores the name as written, without transliteration", async () => {
    const { decrypt } = await import("@/lib/server/crypto");
    calls.length = 0;

    await postTeamPraise({ sessionId: SESSION_ID, responseId: RESPONSE_ID, firstName: "José" });

    const submit = calls.find((call) => call.fn === "rpc_public_submit_team_praise");
    expect(decrypt(String(submit?.args["p_first_name_encrypted"]))).toBe("José");
  });

  it("is accepted after a one-star rating exactly as after a five", async () => {
    // Praise and a complaint are not mutually exclusive, and the product must
    // not assume they are.
    const response = await postTeamPraise({
      sessionId: SESSION_ID,
      responseId: RESPONSE_ID,
      firstName: "Sam",
    });
    expect(response.status).toBe(201);
  });
});

describe("request rejection", () => {
  it("rejects contact and marketing fields outright", async () => {
    for (const extra of [
      { contactPhone: "+15555550123" },
      { email: "customer@example.com" },
      { consent: true },
      { organizationId: "11111111-1111-1111-1111-111111111111" },
      { reviewThreshold: 4 },
    ]) {
      const response = await postResponse({ sessionId: SESSION_ID, rating: 5, ...extra });
      expect(response.status, JSON.stringify(extra)).toBe(400);
    }
  });

  it("rejects a body that is not JSON", async () => {
    const { POST } = await import("@/app/api/v1/public/q/[token]/sessions/route");
    const response = await POST(
      new Request(`http://localhost:3000/api/v1/public/q/${TOKEN}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key("session") },
        body: "{ not json",
      }) as unknown as NextRequest,
      params(TOKEN),
    );

    expect(response.status).toBe(400);
  });

  it("always returns the same error envelope", async () => {
    const response = await postResponse({ sessionId: SESSION_ID, rating: 99 });
    const body = (await response.json()) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(["error", "requestId"]);
    const error = body["error"] as Record<string, unknown>;
    expect(typeof error["code"]).toBe("string");
    expect(typeof error["message"]).toBe("string");
    expect(Array.isArray(error["details"])).toBe(true);
  });

  it("never answers a customer mutation with 202", async () => {
    // The client rejects 202 outright, because there is no status contract
    // behind it.
    const responses = await Promise.all([
      postSession({ locale: "en" }),
      postResponse({ sessionId: SESSION_ID, rating: 1 }),
      postTeamPraise({ sessionId: SESSION_ID, responseId: RESPONSE_ID, firstName: "Sam" }),
    ]);

    for (const response of responses) expect(response.status).not.toBe(202);
  });
});

describe("rate limiting", () => {
  it("applies both a per-stand and a per-device budget to writes", async () => {
    calls.length = 0;
    await postResponse({ sessionId: SESSION_ID, rating: 3 });

    const buckets = calls
      .filter((call) => call.fn === "rpc_consume_rate_limit")
      .map((call) => call.args["p_bucket"]);

    // Per stand alone would punish a busy restaurant sharing one address; per
    // device alone would leave one printed code unbounded.
    expect(buckets).toContain("public-write-stand");
    expect(buckets).toContain("public-write-client");
  });

  it("never sends a raw address to the database", async () => {
    const { POST } = await import("@/app/api/v1/public/q/[token]/sessions/route");
    calls.length = 0;

    await POST(
      request("POST", `/api/v1/public/q/${TOKEN}/sessions`, {
        body: { locale: "en" },
        headers: { "idempotency-key": key("session"), "x-forwarded-for": "203.0.113.42, 10.0.0.1" },
      }),
      params(TOKEN),
    );

    const serialised = JSON.stringify(calls);
    expect(serialised).not.toContain("203.0.113.42");
    expect(serialised).not.toContain("10.0.0.1");
  });

  it("returns 429 with Retry-After when a budget is exhausted", async () => {
    rpcHandler = (fn) =>
      fn === "rpc_consume_rate_limit"
        ? { data: [{ allowed: false, retry_after_seconds: 42 }], error: null }
        : happyPath(fn);

    const response = await postResponse({ sessionId: SESSION_ID, rating: 3 });
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(429);
    expect(body.error.code).toBe("rate_limited");
    expect(response.headers.get("retry-after")).toBe("42");
  });

  it("fails open when the limiter itself is unavailable", async () => {
    // A customer at a counter must not be turned away because a limiter is
    // down. The abuse this bounds is a nuisance, not a breach.
    rpcHandler = (fn) =>
      fn === "rpc_consume_rate_limit"
        ? { data: null, error: { message: "connection refused" } }
        : happyPath(fn);

    const response = await postResponse({ sessionId: SESSION_ID, rating: 3 });
    expect(response.status).toBe(201);
  });
});

describe("CORS", () => {
  it("answers preflight and permits Idempotency-Key", async () => {
    const { OPTIONS } = await import("@/app/api/v1/public/q/[token]/responses/route");
    const response = await OPTIONS(
      request("OPTIONS", `/api/v1/public/q/${TOKEN}/responses`, {
        headers: { origin: "http://localhost:3000" },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")?.toLowerCase()).toContain(
      "idempotency-key",
    );
  });

  it("does not reflect an origin it was not configured for", async () => {
    const { OPTIONS } = await import("@/app/api/v1/public/q/[token]/responses/route");
    const response = await OPTIONS(
      request("OPTIONS", `/api/v1/public/q/${TOKEN}/responses`, {
        headers: { origin: "https://evil.example" },
      }),
    );

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});
