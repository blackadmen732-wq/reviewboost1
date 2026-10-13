import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The Square adapter against a recorded Square: every request it makes is
 * checked for host, path, version header and credentials, and answered with
 * the shapes Square documents. No network, no real account, no real people
 * (555-01xx numbers are reserved for fiction).
 */

const OLD_ENV = { ...process.env };
const NOW = new Date("2026-10-13T18:00:00Z");

const CONFIG = {
  environment: "sandbox" as const,
  applicationId: "sandbox-sq0idb-TESTAPP",
  applicationSecret: "sandbox-sq0csb-SECRET",
  webhookSignatureKey: "whsec-test-key",
  baseUrl: "https://connect.squareupsandbox.com",
};

interface Recorded {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

function recorder(responses: ((request: Recorded) => Response | Promise<Response>)[]) {
  const calls: Recorded[] = [];
  const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
    const request: Recorded = {
      method: init?.method ?? "GET",
      url: new URL(String(input)),
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    calls.push(request);
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected request ${request.method} ${request.url.pathname}`);
    return next(request);
  });
  return { calls, fetch: fetchMock as unknown as typeof fetch };
}

const ok = (body: unknown) => () => Response.json(body);
const fail = (status: number, code: string, headers: Record<string, string> = {}) => () =>
  Response.json({ errors: [{ category: "X", code }] }, { status, headers });

const TOKENS = {
  accessToken: "EAAAl-access",
  refreshToken: "EQAAl-refresh",
  accessExpiresAt: new Date("2026-11-10T00:00:00Z"),
  refreshExpiresAt: null,
  grantedScopes: ["MERCHANT_PROFILE_READ", "CUSTOMERS_READ", "PAYMENTS_READ"],
};
const CTX = { tokens: TOKENS, externalAccountId: "MLR8X4Y7K3Q2", locationIds: ["LOC1", "LOC2"] };

async function adapterWith(responses: Parameters<typeof recorder>[0]) {
  const { createSquareAdapter } = await import("@/lib/server/integrations/providers/square/adapter");
  const recorded = recorder(responses);
  return { adapter: createSquareAdapter({ config: CONFIG, fetch: recorded.fetch, clock: () => NOW }), calls: recorded.calls };
}

beforeEach(() => {
  vi.resetModules();
});

afterAll(() => {
  process.env = { ...OLD_ENV };
});

describe("Square configuration", () => {
  const load = () => import("@/lib/server/integrations/providers/square/config");

  beforeEach(() => {
    process.env.INTEGRATION_CREDENTIAL_KEY = Buffer.alloc(32, 3).toString("base64");
    delete process.env.SQUARE_ENVIRONMENT;
    delete process.env.SQUARE_APPLICATION_ID;
    delete process.env.SQUARE_APPLICATION_SECRET;
    delete process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  });

  it("is off until the application id and secret are set", async () => {
    const { squareConfig, squareConfigProblem } = await load();
    expect(squareConfig()).toBeNull();
    expect(squareConfigProblem()).toMatch(/SQUARE_APPLICATION_ID/);
  });

  it("defaults to the sandbox and refuses a production id there", async () => {
    process.env.SQUARE_APPLICATION_ID = "sq0idp-REALAPP";
    process.env.SQUARE_APPLICATION_SECRET = "secret";
    const { squareConfig, squareConfigProblem } = await load();
    expect(squareConfig()).toBeNull();
    expect(squareConfigProblem()).toMatch(/not a sandbox application id/);

    process.env.SQUARE_APPLICATION_ID = "sandbox-sq0idb-TESTAPP";
    expect(squareConfig()).toMatchObject({
      environment: "sandbox",
      baseUrl: "https://connect.squareupsandbox.com",
      webhookSignatureKey: null,
    });
  });

  it("needs production asked for by name, with a production id", async () => {
    process.env.SQUARE_ENVIRONMENT = "production";
    process.env.SQUARE_APPLICATION_ID = "sandbox-sq0idb-TESTAPP";
    process.env.SQUARE_APPLICATION_SECRET = "secret";
    const { squareConfig } = await load();
    expect(squareConfig()).toBeNull();
    process.env.SQUARE_APPLICATION_ID = "sq0idp-REALAPP";
    expect(squareConfig()?.baseUrl).toBe("https://connect.squareup.com");
  });

  it("will not connect without a key to seal its tokens", async () => {
    process.env.SQUARE_APPLICATION_ID = "sandbox-sq0idb-TESTAPP";
    process.env.SQUARE_APPLICATION_SECRET = "secret";
    delete process.env.INTEGRATION_CREDENTIAL_KEY;
    const { squareConfigProblem } = await load();
    expect(squareConfigProblem()).toMatch(/INTEGRATION_CREDENTIAL_KEY/);
  });

  it("shows Square as connectable, in test mode, only once configured", async () => {
    const registry = () => import("@/lib/server/integrations/registry");
    expect((await registry()).getConnectableProvider("square")).toBeNull();
    expect((await registry()).getProvider("square")?.availability).toBe("in_setup");

    process.env.SQUARE_APPLICATION_ID = "sandbox-sq0idb-TESTAPP";
    process.env.SQUARE_APPLICATION_SECRET = "secret";
    const square = (await registry()).getConnectableProvider("square");
    expect(square?.availability).toBe("available");
    expect(square?.summary).toMatch(/sandbox/i);

    const { getAdapter } = await import("@/lib/server/integrations/adapters");
    expect(getAdapter("square")?.id).toBe("square");
  });
});

describe("Square sign-in", () => {
  it("sends the owner to Square's sandbox with exactly the permissions asked for", async () => {
    const { adapter } = await adapterWith([]);
    const url = adapter.buildAuthorizeUrl({
      state: "st_123",
      scopes: ["MERCHANT_PROFILE_READ", "PAYMENTS_READ"],
      redirectUri: "https://app.example.com/settings/connections/square/callback",
    });
    expect(url.origin).toBe("https://connect.squareupsandbox.com");
    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe(CONFIG.applicationId);
    expect(url.searchParams.get("scope")).toBe("MERCHANT_PROFILE_READ PAYMENTS_READ");
    expect(url.searchParams.get("state")).toBe("st_123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/settings/connections/square/callback");
    // The sandbox does not support session=false.
    expect(url.searchParams.has("session")).toBe(false);
    expect(url.toString()).not.toContain(CONFIG.applicationSecret);
  });

  it("exchanges the code, then asks Square which permissions were really granted", async () => {
    const { adapter, calls } = await adapterWith([
      ok({ access_token: "EAAAl-new", refresh_token: "EQAAl-new", expires_at: "2026-11-12T18:00:00Z", merchant_id: "MLR8X4Y7K3Q2" }),
      ok({ scopes: ["MERCHANT_PROFILE_READ", "CUSTOMERS_READ"], client_id: CONFIG.applicationId, merchant_id: "MLR8X4Y7K3Q2" }),
    ]);
    const tokens = await adapter.exchangeCode({
      code: "sq0cgb-AbC_123",
      redirectUri: "https://app.example.com/settings/connections/square/callback",
      requestedScopes: ["MERCHANT_PROFILE_READ", "CUSTOMERS_READ", "PAYMENTS_READ"],
    });

    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url.pathname).toBe("/oauth2/token");
    expect(calls[0]?.headers["Square-Version"]).toBe("2026-09-16");
    expect(calls[0]?.headers.Authorization).toBeUndefined();
    expect(calls[0]?.body).toEqual({
      client_id: CONFIG.applicationId,
      client_secret: CONFIG.applicationSecret,
      grant_type: "authorization_code",
      code: "sq0cgb-AbC_123",
      redirect_uri: "https://app.example.com/settings/connections/square/callback",
    });
    expect(calls[1]?.url.pathname).toBe("/oauth2/token/status");
    expect(calls[1]?.headers.Authorization).toBe("Bearer EAAAl-new");

    expect(tokens).toMatchObject({ accessToken: "EAAAl-new", refreshToken: "EQAAl-new" });
    expect(tokens.accessExpiresAt?.toISOString()).toBe("2026-11-12T18:00:00.000Z");
    const grant = adapter.verifyGrant(tokens, ["MERCHANT_PROFILE_READ", "CUSTOMERS_READ", "PAYMENTS_READ"]);
    expect(grant).toEqual({ sufficient: false, missing: ["PAYMENTS_READ"] });
  });

  it("refuses a token Square says belongs to another application", async () => {
    const { adapter } = await adapterWith([
      ok({ access_token: "EAAAl-new", expires_at: "2026-11-12T18:00:00Z" }),
      ok({ scopes: [], client_id: "sandbox-sq0idb-OTHER" }),
    ]);
    await expect(
      adapter.exchangeCode({ code: "sq0cgb-x", redirectUri: "https://a.example/cb", requestedScopes: [] }),
    ).rejects.toMatchObject({ classification: { kind: "auth" } });
  });

  it("rejects a malformed code without calling Square", async () => {
    const { adapter, calls } = await adapterWith([]);
    await expect(
      adapter.exchangeCode({ code: "bad code<script>", redirectUri: "https://a.example/cb", requestedScopes: [] }),
    ).rejects.toMatchObject({ classification: { kind: "permanent" } });
    expect(calls).toHaveLength(0);
  });

  it("refreshes weekly, keeping the code-flow refresh token", async () => {
    const { adapter, calls } = await adapterWith([ok({ access_token: "EAAAl-fresh", expires_at: "2026-12-01T00:00:00Z" })]);
    const fresh = new Date(NOW.getTime() + 29 * 86_400_000);
    expect(adapter.shouldRefresh({ ...TOKENS, accessExpiresAt: fresh }, null, NOW)).toBe(false);
    const weekOld = new Date(NOW.getTime() + 22 * 86_400_000);
    expect(adapter.shouldRefresh({ ...TOKENS, accessExpiresAt: weekOld }, null, NOW)).toBe(true);

    const refreshed = await adapter.refresh(TOKENS);
    expect(calls[0]?.body).toMatchObject({ grant_type: "refresh_token", refresh_token: "EQAAl-refresh" });
    expect(refreshed.accessToken).toBe("EAAAl-fresh");
    expect(refreshed.refreshToken).toBe("EQAAl-refresh");
    expect(refreshed.grantedScopes).toEqual(TOKENS.grantedScopes);
  });

  it("revokes with the application secret and treats already-revoked as done", async () => {
    const { adapter, calls } = await adapterWith([ok({ success: true }), fail(401, "ACCESS_TOKEN_REVOKED")]);
    await adapter.revoke(TOKENS);
    expect(calls[0]?.url.pathname).toBe("/oauth2/revoke");
    expect(calls[0]?.headers.Authorization).toBe(`Client ${CONFIG.applicationSecret}`);
    expect(calls[0]?.body).toEqual({ client_id: CONFIG.applicationId, access_token: "EAAAl-access" });
    await expect(adapter.revoke(TOKENS)).resolves.toBeUndefined();
  });
});

describe("Square account and places", () => {
  it("names the business and lists only its active locations", async () => {
    const { adapter, calls } = await adapterWith([
      ok({ merchant: { id: "MLR8X4Y7K3Q2", business_name: "Corner Cafe" } }),
      ok({
        locations: [
          { id: "LOC1", name: "Main Street", timezone: "America/Chicago", status: "ACTIVE" },
          { id: "LOC2", name: "Old shop", timezone: "America/Chicago", status: "INACTIVE" },
        ],
      }),
    ]);
    const account = await adapter.discoverAccount(TOKENS);
    expect(calls.map((call) => call.url.pathname)).toEqual(["/v2/merchants/me", "/v2/locations"]);
    expect(calls[0]?.headers.Authorization).toBe("Bearer EAAAl-access");
    expect(account).toEqual({
      externalAccountId: "MLR8X4Y7K3Q2",
      label: "Corner Cafe",
      locations: [{ externalLocationId: "LOC1", name: "Main Street", timezone: "America/Chicago" }],
    });
  });
});

describe("Square visits", () => {
  const window = { start: new Date("2026-09-13T18:00:00Z"), end: NOW };

  it("reads payments one chosen place at a time, by last change, and only calls COMPLETED a visit", async () => {
    const { adapter, calls } = await adapterWith([
      ok({
        payments: [
          { id: "P1", status: "COMPLETED", location_id: "LOC1", customer_id: "CUST1", created_at: "2026-10-12T15:00:00Z", updated_at: "2026-10-12T15:01:00Z" },
          { id: "P2", status: "APPROVED", location_id: "LOC1", created_at: "2026-10-12T16:00:00Z", updated_at: "2026-10-12T16:00:00Z" },
          { id: "P3", status: "FAILED", location_id: "LOC1", customer_id: "CUST2", created_at: "2026-10-12T17:00:00Z" },
          { id: "P4", status: "COMPLETED" },
        ],
        cursor: "sq-page-2",
      }),
      ok({ payments: [] }),
      ok({ payments: [{ id: "P9", status: "COMPLETED", location_id: "LOC2", created_at: "2026-10-01T10:00:00Z" }] }),
    ]);

    const first = await adapter.fetchVisits(CTX, "payments", window, null);
    expect(calls[0]?.url.pathname).toBe("/v2/payments");
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({
      location_id: "LOC1",
      updated_at_begin_time: window.start.toISOString(),
      updated_at_end_time: NOW.toISOString(),
      sort_field: "UPDATED_AT",
      sort_order: "ASC",
      limit: "100",
    });
    expect(first.items.map((visit) => [visit.externalId, visit.status, visit.customerExternalId])).toEqual([
      ["P1", "completed", "CUST1"],
      ["P2", "pending", null],
      ["P3", "cancelled", "CUST2"],
    ]);
    expect(first.items[0]).toMatchObject({ kind: "payment", externalLocationId: "LOC1", sourceVersion: null });

    const second = await adapter.fetchVisits(CTX, "payments", window, first.next);
    expect(calls[1]?.url.searchParams.get("cursor")).toBe("sq-page-2");
    expect(second.items).toEqual([]);

    const third = await adapter.fetchVisits(CTX, "payments", window, second.next);
    expect(calls[2]?.url.searchParams.get("location_id")).toBe("LOC2");
    expect(third.items.map((visit) => visit.externalId)).toEqual(["P9"]);
    expect(third.next).toBeNull();
  });

  it("reads nothing when no place is chosen", async () => {
    const { adapter, calls } = await adapterWith([]);
    expect(await adapter.fetchVisits({ ...CTX, locationIds: [] }, "payments", window, null)).toEqual({ items: [], next: null });
    expect(calls).toHaveLength(0);
  });

  it("calls an appointment only 'time passed', in 30-day slices with a day of look-back", async () => {
    const { adapter, calls } = await adapterWith([
      ok({
        bookings: [
          { id: "B1", version: 2, status: "ACCEPTED", location_id: "LOC1", customer_id: "CUST1", start_at: "2026-09-20T15:00:00Z", appointment_segments: [{ duration_minutes: 60 }] },
          { id: "B2", version: 1, status: "NO_SHOW", location_id: "LOC1", customer_id: "CUST2", start_at: "2026-09-21T15:00:00Z" },
          { id: "B3", version: 1, status: "CANCELLED_BY_CUSTOMER", location_id: "LOC1", start_at: "2026-09-22T15:00:00Z" },
        ],
      }),
      ok({
        bookings: [
          // Under way at NOW: started 17:30, an hour long.
          { id: "B4", version: 1, status: "ACCEPTED", location_id: "LOC1", start_at: "2026-10-13T17:30:00Z", appointment_segments: [{ duration_minutes: 60 }] },
          { id: "B5", version: 1, status: "PENDING", location_id: "LOC1", start_at: "2026-10-13T09:00:00Z" },
        ],
      }),
    ]);
    const ctx = { ...CTX, locationIds: ["LOC1"] };
    const first = await adapter.fetchVisits(ctx, "appointments", window, null);
    expect(calls[0]?.url.pathname).toBe("/v2/bookings");
    const min = new Date(calls[0]!.url.searchParams.get("start_at_min")!);
    const max = new Date(calls[0]!.url.searchParams.get("start_at_max")!);
    expect(min.toISOString()).toBe("2026-09-12T18:00:00.000Z");
    expect(max.getTime() - min.getTime()).toBe(30 * 86_400_000);
    expect(first.items.map((visit) => [visit.externalId, visit.status, visit.sourceVersion])).toEqual([
      ["B1", "appointment_time_passed", 2],
      ["B2", "no_show", 1],
      ["B3", "cancelled", 1],
    ]);
    expect(first.next).not.toBeNull();

    const second = await adapter.fetchVisits(ctx, "appointments", window, first.next);
    expect(calls[1]?.url.searchParams.get("start_at_min")).toBe(max.toISOString());
    expect(calls[1]?.url.searchParams.get("start_at_max")).toBe(NOW.toISOString());
    expect(second.items.map((visit) => [visit.externalId, visit.status])).toEqual([
      ["B4", "pending"],
      ["B5", "pending"],
    ]);
    expect(second.next).toBeNull();
  });

  it("refuses a cursor it did not write", async () => {
    const { adapter } = await adapterWith([]);
    await expect(adapter.fetchVisits(CTX, "payments", window, "not-a-cursor")).rejects.toMatchObject({
      classification: { kind: "permanent", reason: "invalid_request" },
    });
  });
});

describe("Square customers", () => {
  it("reads customers 100 at a time and skips ids Square no longer knows", async () => {
    const ids = Array.from({ length: 101 }, (_, index) => `CUST${index}`);
    const { adapter, calls } = await adapterWith([
      ok({
        responses: {
          CUST0: { customer: { id: "CUST0", given_name: "Ana", family_name: "Ruiz", phone_number: "+1 202-555-0101", version: 4, created_at: "2026-01-01T00:00:00Z" } },
          CUST1: { errors: [{ code: "NOT_FOUND" }] },
          CUST2: { customer: { id: "CUST2", company_name: "Acme Ltd" } },
        },
      }),
      ok({ responses: { CUST100: { customer: { id: "CUST100", nickname: "Ben" } } } }),
    ]);
    const customers = await adapter.fetchCustomersByIds(CTX, ids);
    expect(calls.map((call) => (call.body as { customer_ids: string[] }).customer_ids.length)).toEqual([100, 1]);
    expect(calls[0]?.url.pathname).toBe("/v2/customers/bulk-retrieve");
    expect(customers).toEqual([
      expect.objectContaining({ externalId: "CUST0", name: "Ana Ruiz", phone: "+1 202-555-0101", sourceVersion: 4 }),
      expect.objectContaining({ externalId: "CUST2", name: "Acme Ltd", phone: null }),
      expect.objectContaining({ externalId: "CUST100", name: "Ben" }),
    ]);
    // Square's profile has no texting permission; nothing here claims one.
    expect(Object.keys(customers[0]!)).not.toContain("consent");
  });
});

describe("Square errors", () => {
  it("classifies Square's answers for the sync runner", async () => {
    const { classifySquareResponse } = await import("@/lib/server/integrations/providers/square/adapter");
    const h = (init?: Record<string, string>) => new Headers(init);
    expect(classifySquareResponse(429, { errors: [{ code: "RATE_LIMITED" }] }, h({ "retry-after": "7" }))).toEqual({
      kind: "retryable",
      reason: "rate_limited",
      retryAfterMs: 7000,
    });
    expect(classifySquareResponse(401, { errors: [{ code: "ACCESS_TOKEN_EXPIRED" }] }, h())).toEqual({ kind: "auth", reason: "token_expired" });
    expect(classifySquareResponse(401, { errors: [{ code: "ACCESS_TOKEN_REVOKED" }] }, h())).toEqual({ kind: "auth", reason: "token_revoked" });
    expect(classifySquareResponse(403, { errors: [{ code: "INSUFFICIENT_SCOPES" }] }, h())).toEqual({ kind: "auth", reason: "insufficient_scope" });
    expect(classifySquareResponse(404, null, h())).toEqual({ kind: "permanent", reason: "not_found" });
    expect(classifySquareResponse(503, null, h())).toEqual({ kind: "retryable", reason: "server_error" });
    expect(classifySquareResponse(400, { errors: [{ code: "INVALID_CURSOR" }] }, h())).toEqual({ kind: "permanent", reason: "invalid_request" });
  });

  it("never puts a token or a response body into an error", async () => {
    const { adapter } = await adapterWith([
      () => Response.json({ errors: [{ code: "UNAUTHORIZED", detail: "token EAAAl-access for +12025550101" }] }, { status: 401 }),
    ]);
    const error = await adapter.discoverAccount(TOKENS).catch((caught: Error) => caught);
    expect(String((error as Error).message)).toBe("square:401:UNAUTHORIZED");
  });

  it("treats an unreachable Square as retryable", async () => {
    const { createSquareAdapter } = await import("@/lib/server/integrations/providers/square/adapter");
    const adapter = createSquareAdapter({
      config: CONFIG,
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    await expect(adapter.discoverAccount(TOKENS)).rejects.toMatchObject({ classification: { kind: "retryable", reason: "network" } });
  });
});

describe("Square webhooks", () => {
  const URL_ = "https://app.example.com/api/v1/webhooks/integrations/square";
  const body = JSON.stringify({
    merchant_id: "MLR8X4Y7K3Q2",
    type: "booking.updated",
    event_id: "8478cc17-a7b9-40e6-b5fa-692e58794ff5",
    created_at: "2026-10-13T17:00:00Z",
    data: { type: "booking", id: "B1", object: { booking: { id: "B1", version: 3 } } },
  });

  it("accepts Square's signature over the URL and raw body, and nothing else", async () => {
    const { adapter } = await adapterWith([]);
    const { signSquareWebhook } = await import("@/lib/server/integrations/providers/square/adapter");
    const signature = signSquareWebhook(URL_, body, CONFIG.webhookSignatureKey);
    const headers = new Headers({ "x-square-hmacsha256-signature": signature });
    expect(adapter.verifyWebhook({ rawBody: body, headers, url: URL_ })).toBe(true);
    expect(adapter.verifyWebhook({ rawBody: `${body} `, headers, url: URL_ })).toBe(false);
    expect(adapter.verifyWebhook({ rawBody: body, headers, url: `${URL_}/` })).toBe(false);
    expect(adapter.verifyWebhook({ rawBody: body, headers: new Headers(), url: URL_ })).toBe(false);
  });

  it("refuses every webhook until a signature key is configured", async () => {
    const { createSquareAdapter, signSquareWebhook } = await import("@/lib/server/integrations/providers/square/adapter");
    const adapter = createSquareAdapter({ config: { ...CONFIG, webhookSignatureKey: null } });
    const headers = new Headers({ "x-square-hmacsha256-signature": signSquareWebhook(URL_, body, "") });
    expect(adapter.verifyWebhook({ rawBody: body, headers, url: URL_ })).toBe(false);
  });

  it("files an event by what it names, and re-reads the current object", async () => {
    const { adapter, calls } = await adapterWith([
      ok({ booking: { id: "B1", version: 3, status: "ACCEPTED", location_id: "LOC1", customer_id: "CUST1", start_at: "2026-10-13T10:00:00Z" } }),
      ok({ customer: { id: "CUST1", given_name: "Ana", phone_number: "+12025550101" } }),
    ]);
    const event = adapter.parseWebhook(body);
    expect(event).toMatchObject({
      providerEventId: "8478cc17-a7b9-40e6-b5fa-692e58794ff5",
      externalAccountId: "MLR8X4Y7K3Q2",
      type: "booking.updated",
      objectType: "booking",
      objectId: "B1",
      objectVersion: 3,
    });
    const resolved = await adapter.resolveEvent(CTX, event);
    expect(calls.map((call) => call.url.pathname)).toEqual(["/v2/bookings/B1", "/v2/customers/CUST1"]);
    expect(resolved.visits[0]).toMatchObject({ externalId: "B1", status: "appointment_time_passed" });
    expect(resolved.customers[0]).toMatchObject({ externalId: "CUST1", name: "Ana" });
    expect(resolved.revoked).toBe(false);
  });

  it("treats a deleted object as nothing to apply", async () => {
    const { adapter } = await adapterWith([fail(404, "NOT_FOUND")]);
    const event = adapter.parseWebhook(
      JSON.stringify({ merchant_id: "MLR8X4Y7K3Q2", type: "customer.deleted", event_id: "e2", created_at: "2026-10-13T17:00:00Z", data: { type: "customer", id: "GONE" } }),
    );
    expect(await adapter.resolveEvent(CTX, event)).toEqual({ customers: [], visits: [], revoked: false });
  });

  it("hears the seller removing access", async () => {
    const { adapter, calls } = await adapterWith([]);
    const event = adapter.parseWebhook(
      JSON.stringify({ merchant_id: "MLR8X4Y7K3Q2", type: "oauth.authorization.revoked", event_id: "e3", created_at: "2026-10-13T17:00:00Z", data: { type: "revocation", id: "r1" } }),
    );
    expect(event.objectType).toBe("authorization");
    expect((await adapter.resolveEvent(CTX, event)).revoked).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("rejects an event it cannot file", async () => {
    const { adapter } = await adapterWith([]);
    expect(() => adapter.parseWebhook(JSON.stringify({ type: "payment.updated" }))).toThrow();
    expect(() =>
      adapter.parseWebhook(JSON.stringify({ merchant_id: "bad id!", type: "payment.updated", event_id: "e", created_at: "2026-10-13T17:00:00Z" })),
    ).toThrow();
  });
});
