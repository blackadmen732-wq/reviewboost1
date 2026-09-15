import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Entitlements as the product defines them, and Tag creation that cannot leave
 * a Tag nobody can reprint.
 *
 * The database is the enforcement boundary — `supabase/tests/entitlements_test.sql`
 * performs the create as a real role and `scripts/backend/concurrency-proof.sh`
 * races eight of them at one free slot. What is tested here is the layer above:
 * the plan numbers this code hands to an owner, and the call shape it sends.
 */

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

const rpcCalls: RpcCall[] = [];
let rpcResult: { data: unknown; error: { message: string } | null } = { data: "stand-1", error: null };
let entitlementRow: Record<string, unknown> | null = {
  plan_id: "starter",
  status: "active",
  cancel_at_period_end: false,
  trial_ends_at: null,
  current_period_end: null,
};
let standCount = 0;

function queryBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "order", "limit", "lt", "is", "in", "not", "eq", "neq"]) {
    builder[method] = chain;
  }
  builder["maybeSingle"] = () =>
    Promise.resolve({ data: table === "entitlement_snapshots" ? entitlementRow : null, error: null });
  builder["then"] = (resolve: (v: { data: unknown; error: unknown; count?: number }) => unknown) =>
    resolve({ data: [], error: null, count: standCount });
  return builder;
}

function fakeClient() {
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "user-1" } }, error: null }) },
    from: (table: string) => ({
      select: () => queryBuilder(table),
      update: () => queryBuilder(table),
      insert: () => queryBuilder(table),
    }),
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(rpcResult);
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
  process.env.TOKEN_DIGEST_KEY = Buffer.alloc(32, 7).toString("base64");
});

beforeEach(() => {
  rpcCalls.length = 0;
  rpcResult = { data: "stand-1", error: null };
  entitlementRow = {
    plan_id: "starter",
    status: "active",
    cancel_at_period_end: false,
    trial_ends_at: null,
    current_period_end: null,
  };
  standCount = 0;
});

async function context() {
  const { createClient } = await import("@supabase/supabase-js");
  return {
    db: createClient("", "") as never,
    userId: "user-1",
    orgId: ORG,
    role: "owner" as const,
  };
}

describe("the locked V1 plans", () => {
  it("matches the product rules exactly", async () => {
    const { PLANS, TRIAL_LIMITS, TRIAL_DAYS } = await import("@/lib/server/entitlements");

    expect(PLANS.starter).toEqual({
      locations: 1,
      tags: 3,
      monthlySmsSegments: 150,
      priceUsdCents: 4900,
    });
    expect(PLANS.growth).toEqual({
      locations: 2,
      tags: 8,
      monthlySmsSegments: 500,
      priceUsdCents: 7900,
    });
    expect(PLANS.pro).toEqual({
      locations: 5,
      tags: 25,
      monthlySmsSegments: 1500,
      priceUsdCents: 12900,
    });
    // A trial costs nothing, includes one of everything physical, and — this is
    // the one people get wrong — no SMS at all.
    expect(TRIAL_LIMITS).toEqual({
      locations: 1,
      tags: 1,
      monthlySmsSegments: 0,
      priceUsdCents: 0,
    });
    expect(TRIAL_DAYS).toBe(7);
  });

  it("never falls back to Starter for an unknown or inactive plan", async () => {
    const { tagLimit, locationLimit, monthlySmsSegments } = await import(
      "@/lib/server/entitlements"
    );

    expect(tagLimit(null, "active")).toBe(0);
    expect(tagLimit("starter", "cancelled")).toBe(0);
    expect(tagLimit("starter", "suspended")).toBe(0);
    expect(tagLimit("starter", "past_due")).toBe(0);
    expect(locationLimit(null, "active")).toBe(0);
    expect(monthlySmsSegments(null)).toBe(0);
  });

  it("keeps the door open through a failed card and shuts it on suspension", async () => {
    const { allowsService } = await import("@/lib/server/entitlements");

    expect(allowsService("trialing")).toBe(true);
    expect(allowsService("active")).toBe(true);
    // A bank's fraud heuristic must not cost a business a day of reviews.
    expect(allowsService("past_due")).toBe(true);
    expect(allowsService("cancelled")).toBe(false);
    expect(allowsService("suspended")).toBe(false);
  });
});

describe("createStand", () => {
  it("stores the reprint ciphertext in the same statement as the Tag", async () => {
    const { createStand } = await import("@/lib/server/owner-service");
    await createStand(await context(), ORG, LOCATION, "Counter", "req-1");

    const create = rpcCalls.find(({ name }) => name === "rpc_create_stand");
    expect(create).toBeDefined();
    expect(create?.args["p_token_ciphertext"]).toMatch(/^v1:/);
    expect(create?.args["p_cipher_key_version"]).toBeTypeOf("number");

    // The follow-up call whose error used to be discarded is gone. A Tag that
    // cannot be reprinted must not be reported as created.
    expect(rpcCalls.some(({ name }) => name === "rpc_set_stand_token_ciphertext")).toBe(false);
  });

  it("refuses before the database when the plan is already full", async () => {
    standCount = 3;
    const { createStand } = await import("@/lib/server/owner-service");

    await expect(createStand(await context(), ORG, LOCATION, "Fourth", "req-2")).rejects.toThrow(
      /includes 3 Tags/,
    );
    expect(rpcCalls.some(({ name }) => name === "rpc_create_stand")).toBe(false);
  });

  it("refuses when the plan is not active", async () => {
    entitlementRow = {
      plan_id: "starter",
      status: "cancelled",
      cancel_at_period_end: false,
      trial_ends_at: null,
      current_period_end: null,
    };
    const { createStand } = await import("@/lib/server/owner-service");

    await expect(createStand(await context(), ORG, LOCATION, "Nope", "req-3")).rejects.toThrow(
      /not active/,
    );
  });

  it("does not treat a missing entitlement as permission", async () => {
    entitlementRow = null;
    const { createStand } = await import("@/lib/server/owner-service");

    await expect(createStand(await context(), ORG, LOCATION, "Nope", "req-4")).rejects.toThrow();
    expect(rpcCalls.some(({ name }) => name === "rpc_create_stand")).toBe(false);
  });

  it("turns the database's own cap refusal into an owner-readable message", async () => {
    // The pre-check passes and the database still refuses — which is what
    // happens when another request took the last slot in between.
    rpcResult = { data: null, error: { message: "tag_limit_reached" } };
    const { createStand } = await import("@/lib/server/owner-service");

    await expect(createStand(await context(), ORG, LOCATION, "Racer", "req-5")).rejects.toThrow(
      /one Tag more than your plan/,
    );
  });

  it("surfaces a refused ciphertext rather than reporting success", async () => {
    rpcResult = { data: null, error: { message: "ciphertext_required" } };
    const { createStand } = await import("@/lib/server/owner-service");

    await expect(createStand(await context(), ORG, LOCATION, "Broken", "req-6")).rejects.toThrow();
  });
});

describe("createLocation", () => {
  it("counts against the plan's places", async () => {
    standCount = 1;
    const { createLocation } = await import("@/lib/server/owner-service");

    await expect(createLocation(await context(), ORG, "Second Shop", "req-7")).rejects.toThrow(
      /includes 1 place/,
    );
    expect(rpcCalls.some(({ name }) => name === "rpc_create_location")).toBe(false);
  });

  it("creates one when the plan has room", async () => {
    entitlementRow = {
      plan_id: "growth",
      status: "active",
      cancel_at_period_end: false,
      trial_ends_at: null,
      current_period_end: null,
    };
    standCount = 1;
    rpcResult = { data: "location-2", error: null };
    const { createLocation } = await import("@/lib/server/owner-service");

    const created = await createLocation(await context(), ORG, "Second Shop", "req-8");
    expect(created.locationId).toBe("location-2");
    expect(rpcCalls.find(({ name }) => name === "rpc_create_location")?.args["p_org_id"]).toBe(ORG);
  });
});
