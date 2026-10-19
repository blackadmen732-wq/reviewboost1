import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Deleting your own login (launch gap L1).
 *
 * The properties: the person deleted is always the session's person; nobody
 * who is a business's only owner is deleted out from under it; a failed check
 * deletes nothing; and the confirmation word is required.
 */

type Event = { kind: string; name: string; value?: unknown };
const events: Event[] = [];

let authUser: { id: string } | null = { id: "user-1" };
let blockers: Array<{ org_id: string; name: string }> = [];
let blockerError: { message: string } | null = null;
let deleteUserError: { message: string } | null = null;

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve(
          authUser
            ? { data: { user: authUser }, error: null }
            : { data: { user: null }, error: { message: "bad" } },
        ),
    },
    rpc: (name: string, args: unknown) => {
      events.push({ kind: "rpc", name, value: args });
      return Promise.resolve({ data: blockerError ? null : blockers, error: blockerError });
    },
  }),
}));

vi.mock("@/lib/server/supabase", () => ({
  serviceRoleClient: () => ({
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
});

beforeEach(() => {
  events.length = 0;
  authUser = { id: "user-1" };
  blockers = [];
  blockerError = null;
  deleteUserError = null;
});

async function call(method: "GET" | "POST", body?: unknown): Promise<Response> {
  const route = await import("@/app/api/v1/account/personal-deletion/route");
  const request = new Request("http://localhost:3000/api/v1/account/personal-deletion", {
    method,
    headers: {
      authorization: "Bearer session-token",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return method === "GET" ? route.GET(request as never) : route.POST(request as never);
}

const deletedIds = () =>
  events.filter((event) => event.name === "deleteUser").map((event) => event.value);

describe("deleting your own account", () => {
  it("deletes the session's login, and only that one", async () => {
    const response = await call("POST", { confirmation: "Delete" });
    expect(response.status).toBe(200);
    expect(deletedIds()).toEqual(["user-1"]);
  });

  it("refuses an extra field such as a user id", async () => {
    const response = await call("POST", { confirmation: "delete", userId: "someone-else" });
    expect(response.status).toBe(400);
    expect(deletedIds()).toEqual([]);
  });

  it("needs the word delete", async () => {
    const response = await call("POST", { confirmation: "yes" });
    expect(response.status).toBe(400);
    expect(deletedIds()).toEqual([]);
  });

  it("names the business and deletes nothing for its only owner", async () => {
    blockers = [{ org_id: "org-1", name: "Solo Salon" }];
    const response = await call("POST", { confirmation: "delete" });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("owns_business");
    expect(body.error.message).toContain("Solo Salon");
    expect(deletedIds()).toEqual([]);
  });

  it("deletes nothing when it cannot check the businesses", async () => {
    blockerError = { message: "timeout" };
    const response = await call("POST", { confirmation: "delete" });
    expect(response.status).toBe(503);
    expect(deletedIds()).toEqual([]);
  });

  it("says plainly when the login could not be removed", async () => {
    deleteUserError = { message: "auth down" };
    const response = await call("POST", { confirmation: "delete" });
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/not deleted/i);
  });

  it("rejects a request without a session", async () => {
    authUser = null;
    const response = await call("POST", { confirmation: "delete" });
    expect(response.status).toBe(401);
    expect(deletedIds()).toEqual([]);
  });

  it("tells the screen beforehand whether deleting is allowed", async () => {
    blockers = [
      { org_id: "org-1", name: "Solo Salon" },
      { org_id: "org-2", name: "Corner Cafe" },
    ];
    const response = await call("GET");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { allowed: boolean; blockers: Array<{ name: string }> };
    };
    expect(body.data.allowed).toBe(false);
    expect(body.data.blockers.map((blocker) => blocker.name)).toEqual(["Solo Salon", "Corner Cafe"]);
    expect(deletedIds()).toEqual([]);
  });
});
