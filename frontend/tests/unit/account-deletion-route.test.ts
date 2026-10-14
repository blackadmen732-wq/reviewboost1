import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Deleting an account, as behaviour rather than as source text.
 *
 * The property this file exists for is ordering. The route cancels the Stripe
 * subscription *before* it deletes the organization, because the row holding
 * the subscription id is about to be destroyed and a business still being
 * charged for an account that no longer exists is the worst outcome available.
 * A source-text check cannot see that; it would pass just as happily if the two
 * calls were swapped. So the calls are recorded in order and the order is
 * asserted, including the case where Stripe fails and nothing must be deleted
 * at all.
 */

type Event = { kind: string; name: string; value?: unknown };

const events: Event[] = [];

let authUser: { id: string } | null = { id: "user-1" };
let membershipRows: { org_id: string; role: string }[] = [
  { org_id: "11111111-1111-1111-1111-111111111111", role: "owner" },
];
/** Memberships left after the organization is deleted. */
let remainingMemberships: unknown[] = [];
let rpcError: { message: string } | null = null;
/** What rpc_delete_organization_check answers. */
let checkError: { message: string } | null = null;
let billingRefs: unknown = { stripe_subscription_id: "sub_123", stripe_status: "active" };
let cancelImpl: (id: string) => Promise<unknown> = (id) => {
  events.push({ kind: "stripe", name: "cancel", value: id });
  return Promise.resolve({});
};
let deleteUserError: { message: string } | null = null;

function userQueryBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "order", "eq", "limit"]) builder[method] = chain;
  builder["maybeSingle"] = () => Promise.resolve({ data: rows[0] ?? null, error: null });
  builder["then"] = (resolve: (v: { data: unknown; error: unknown }) => unknown) =>
    resolve({ data: rows, error: null });
  return builder;
}

function fakeUserClient() {
  let membershipReads = 0;
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
      events.push({ kind: "from", name: table });
      if (table === "organization_members") {
        // The first read resolves the org context; the second is the
        // "does this login still belong to anything?" check after the delete.
        membershipReads += 1;
        return userQueryBuilder(membershipReads === 1 ? membershipRows : remainingMemberships);
      }
      return userQueryBuilder([]);
    },
    rpc: (name: string, args: unknown) => {
      events.push({ kind: "rpc", name, value: args });
      if (name === "rpc_delete_organization_check") {
        return Promise.resolve({ data: null, error: checkError });
      }
      return Promise.resolve({
        data: rpcError ? null : { ratings: 3 },
        error: rpcError,
      });
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({ createClient: () => fakeUserClient() }));

vi.mock("@/lib/server/stripe", () => ({
  stripeClient: () => ({ subscriptions: { cancel: (id: string) => cancelImpl(id) } }),
}));

vi.mock("@/lib/server/supabase", () => ({
  // No `.schema()` here on purpose: the Data API serves only `public`, so a
  // route that reaches for another schema fails in production, and must fail
  // here too.
  serviceRoleClient: () => ({
    rpc: (name: string, args: unknown) => {
      events.push({ kind: "service-rpc", name, value: args });
      return Promise.resolve({ data: [billingRefs], error: null });
    },
    auth: {
      admin: {
        deleteUser: (id: string) => {
          events.push({ kind: "auth-admin", name: "deleteUser", value: id });
          return Promise.resolve({ error: deleteUserError });
        },
      },
    },
  }),
}));

beforeAll(() => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  process.env.PUBLIC_FRONTEND_URL = "https://app.reviewboost.test";
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
});

beforeEach(() => {
  events.length = 0;
  authUser = { id: "user-1" };
  membershipRows = [{ org_id: "11111111-1111-1111-1111-111111111111", role: "owner" }];
  remainingMemberships = [];
  rpcError = null;
  checkError = null;
  billingRefs = { stripe_subscription_id: "sub_123", stripe_status: "active" };
  cancelImpl = (id) => {
    events.push({ kind: "stripe", name: "cancel", value: id });
    return Promise.resolve({});
  };
  deleteUserError = null;
});

async function post(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/v1/account/deletion/route");
  const request = new Request("http://localhost:3000/api/v1/account/deletion", {
    method: "POST",
    headers: {
      authorization: "Bearer session-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return POST(request as never);
}

const names = () => events.map((event) => `${event.kind}:${event.name}`);
const deleted = () => events.some((e) => e.name === "rpc_delete_organization");

describe("deleting an account", () => {
  it("cancels the subscription before it deletes anything", async () => {
    const response = await post({ confirmation: "Doomed Diner" });
    expect(response.status).toBe(200);

    const order = names();
    const cancelledAt = order.indexOf("stripe:cancel");
    const deletedAt = order.indexOf("rpc:rpc_delete_organization");

    expect(cancelledAt).toBeGreaterThanOrEqual(0);
    expect(deletedAt).toBeGreaterThanOrEqual(0);
    expect(cancelledAt).toBeLessThan(deletedAt);
  });

  it("reads the Stripe ids through a public rpc_* function", async () => {
    const response = await post({ confirmation: "Doomed Diner" });

    expect(response.status).toBe(200);
    expect(names()).toContain("service-rpc:rpc_billing_refs_for_org");
  });

  it("checks the typed name before Stripe, and cancels nothing when it is wrong", async () => {
    checkError = { message: 'raise exception "confirmation_mismatch"' };

    const response = await post({ confirmation: "Old Diner Name" });

    expect(response.status).toBe(400);
    expect(names()).not.toContain("stripe:cancel");
    expect(deleted()).toBe(false);
    const order = names();
    expect(order.indexOf("rpc:rpc_delete_organization_check")).toBeGreaterThanOrEqual(0);
  });

  it("cancels nothing for a caller the database will not let delete", async () => {
    checkError = { message: 'raise exception "not_found_or_forbidden"' };

    const response = await post({ confirmation: "Doomed Diner" });

    expect(response.status).toBe(404);
    expect(names()).not.toContain("stripe:cancel");
    expect(deleted()).toBe(false);
  });

  it("deletes nothing at all when Stripe cannot be reached", async () => {
    cancelImpl = () => Promise.reject(new Error("network down"));

    const response = await post({ confirmation: "Doomed Diner" });

    expect(response.status).toBe(503);
    expect(deleted()).toBe(false);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/cancel from billing/i);
  });

  it("proceeds when Stripe has already forgotten the subscription", async () => {
    cancelImpl = () => Promise.reject(Object.assign(new Error("no such sub"), {
      code: "resource_missing",
    }));

    const response = await post({ confirmation: "Doomed Diner" });

    expect(response.status).toBe(200);
    expect(deleted()).toBe(true);
  });

  it("does not call Stripe for a business that never subscribed", async () => {
    billingRefs = null;

    const response = await post({ confirmation: "Doomed Diner" });

    expect(response.status).toBe(200);
    expect(names()).not.toContain("stripe:cancel");
    expect(deleted()).toBe(true);
  });

  it("refuses an admin, and touches neither Stripe nor the database", async () => {
    membershipRows = [{ org_id: "11111111-1111-1111-1111-111111111111", role: "admin" }];

    const response = await post({ confirmation: "Doomed Diner" });

    expect(response.status).toBe(403);
    expect(deleted()).toBe(false);
    expect(names()).not.toContain("stripe:cancel");
  });

  it("reports a confirmation the database rejected as a field error", async () => {
    rpcError = { message: 'raise exception "confirmation_mismatch"' };

    const response = await post({ confirmation: "Not The Name" });

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { details?: { field: string }[] };
    };
    expect(body.error.details?.[0]?.field).toBe("confirmation");
  });

  it("hides an unauthorised organization behind the same not-found as a missing one", async () => {
    rpcError = { message: 'raise exception "not_found_or_forbidden"' };

    const response = await post({ confirmation: "Doomed Diner" });

    expect(response.status).toBe(404);
  });
});

describe("identity is never something the caller supplies", () => {
  /**
   * The rule the owner stated: nobody may type another person's address and
   * delete their account. The defence is that the request carries no identity
   * at all — so a body that tries to name a victim is rejected outright rather
   * than being quietly ignored, which is what `strictObject` buys.
   */
  it("rejects a body carrying someone else's email", async () => {
    const response = await post({
      confirmation: "Doomed Diner",
      email: "victim@example.com",
    });

    expect(response.status).toBe(400);
    expect(deleted()).toBe(false);
  });

  it("rejects a body carrying another user id or org id", async () => {
    for (const extra of [{ userId: "user-2" }, { orgId: "22222222-2222-2222-2222-222222222222" }]) {
      events.length = 0;
      const response = await post({ confirmation: "Doomed Diner", ...extra });
      expect(response.status).toBe(400);
      expect(deleted()).toBe(false);
    }
  });

  it("passes the organization from the session, never from the body", async () => {
    await post({ confirmation: "Doomed Diner" });

    const call = events.find((event) => event.name === "rpc_delete_organization");
    expect(call?.value).toEqual({
      p_org_id: "11111111-1111-1111-1111-111111111111",
      p_confirmation: "Doomed Diner",
    });
  });
});

describe("the login itself", () => {
  it("is removed when it now belongs to nothing", async () => {
    remainingMemberships = [];

    const response = await post({ confirmation: "Doomed Diner" });
    const body = (await response.json()) as { data: { signInRemoved: boolean } };

    expect(names()).toContain("auth-admin:deleteUser");
    expect(body.data.signInRemoved).toBe(true);
  });

  it("survives when the person still owns another business", async () => {
    remainingMemberships = [{ org_id: "22222222-2222-2222-2222-222222222222" }];

    const response = await post({ confirmation: "Doomed Diner" });
    const body = (await response.json()) as { data: { signInRemoved: boolean } };

    expect(names()).not.toContain("auth-admin:deleteUser");
    expect(body.data.signInRemoved).toBe(false);
  });

  it("still reports success if only the login could not be removed", async () => {
    // The business and its data are gone, which is what was asked for. A
    // stranded login is a loose end for support, not a failed deletion.
    deleteUserError = { message: "auth unavailable" };

    const response = await post({ confirmation: "Doomed Diner" });

    expect(response.status).toBe(200);
    expect(deleted()).toBe(true);
  });
});
