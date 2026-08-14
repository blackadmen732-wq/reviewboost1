import type { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Tests for PATCH /api/v1/team-praise/[praiseId].
 *
 * Proves that not_found_or_forbidden is never swallowed — every RPC path
 * (match, unmatch, share, unshare, archive, restore) returns 404 for missing
 * or unauthorized praise. No fabricated success status is ever returned.
 */

let authUser: { id: string } | null = { id: "user-1" };
let membershipRows: unknown[] = [{ org_id: "org-1", role: "owner" }];
let rpcError: { message: string; code?: string } | null = null;
let viewRows: unknown[] = [];

function queryBuilder(rows?: unknown[]) {
  const effectiveRows = rows ?? [];
  const builder: Record<string, unknown> = {};
  const chain = () => builder;

  for (const method of ["select", "order", "limit", "lt", "is", "eq"]) {
    builder[method] = chain;
  }
  builder["maybeSingle"] = () =>
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
      const rows = table === "organization_members" ? membershipRows : viewRows;
      return {
        select: () => queryBuilder(rows),
        update: () => queryBuilder(),
        insert: () => queryBuilder(),
      };
    },
    rpc: () => {
      return Promise.resolve({ data: null, error: rpcError });
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => fakeClient(),
}));

vi.mock("@/lib/server/supabase", () => ({
  serviceRoleClient: () => fakeClient(),
}));

beforeAll(() => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  process.env.PUBLIC_FRONTEND_URL = "https://app.reviewboost.test";
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
});

beforeEach(() => {
  authUser = { id: "user-1" };
  membershipRows = [{ org_id: "org-1", role: "owner" }];
  rpcError = null;
  viewRows = [];
});

const PRAISE_ID = "33333333-3333-3333-3333-333333333333";
const STAFF_ID = "44444444-4444-1444-8444-444444444444";

function patchRequest(body: unknown): NextRequest {
  return new Request(`http://localhost:3000/api/v1/team-praise/${PRAISE_ID}`, {
    method: "PATCH",
    headers: {
      authorization: "Bearer valid-session-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

async function callPatch(body: unknown): Promise<Response> {
  const { PATCH } = await import("@/app/api/v1/team-praise/[praiseId]/route");
  return PATCH(patchRequest(body), { params: Promise.resolve({ praiseId: PRAISE_ID }) });
}

describe("PATCH /api/v1/team-praise/[praiseId]", () => {
  describe("match", () => {
    it("returns 200 on success", async () => {
      const res = await callPatch({ staffId: STAFF_ID });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe("matched");
    });

    it("returns 404 for not_found_or_forbidden", async () => {
      rpcError = { message: "not_found_or_forbidden", code: "P0001" };
      const res = await callPatch({ staffId: STAFF_ID });
      expect(res.status).toBe(404);
    });

    it("returns 404 for invalid_staff_member", async () => {
      rpcError = { message: "invalid_staff_member", code: "P0001" };
      const res = await callPatch({ staffId: STAFF_ID });
      expect(res.status).toBe(404);
    });

    it("returns 503 for database failure", async () => {
      rpcError = { message: "connection refused" };
      const res = await callPatch({ staffId: STAFF_ID });
      expect(res.status).toBe(503);
    });
  });

  describe("unmatch", () => {
    it("returns 200 on success", async () => {
      const res = await callPatch({ staffId: null });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe("unmatched");
    });

    it("returns 404 for not_found_or_forbidden", async () => {
      rpcError = { message: "not_found_or_forbidden", code: "P0001" };
      const res = await callPatch({ staffId: null });
      expect(res.status).toBe(404);
    });
  });

  describe("share", () => {
    it("returns 200 on success", async () => {
      const res = await callPatch({ shared: true });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe("shared");
    });

    it("returns 404 for not_found_or_forbidden — never swallows", async () => {
      rpcError = { message: "not_found_or_forbidden", code: "P0001" };
      const res = await callPatch({ shared: true });
      expect(res.status).toBe(404);
    });

    it("returns 503 for database failure", async () => {
      rpcError = { message: "connection refused" };
      const res = await callPatch({ shared: true });
      expect(res.status).toBe(503);
    });
  });

  describe("unshare", () => {
    it("returns 200 on success", async () => {
      const res = await callPatch({ shared: false });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe("unmatched");
    });

    it("returns 404 for not_found_or_forbidden — never swallows", async () => {
      rpcError = { message: "not_found_or_forbidden", code: "P0001" };
      const res = await callPatch({ shared: false });
      expect(res.status).toBe(404);
    });
  });

  describe("archive", () => {
    it("returns 200 on success", async () => {
      const res = await callPatch({ archived: true });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe("archived");
    });

    it("returns 404 for not_found_or_forbidden — never swallows", async () => {
      rpcError = { message: "not_found_or_forbidden", code: "P0001" };
      const res = await callPatch({ archived: true });
      expect(res.status).toBe(404);
    });

    it("returns 503 for database failure", async () => {
      rpcError = { message: "connection refused" };
      const res = await callPatch({ archived: true });
      expect(res.status).toBe(503);
    });
  });

  describe("restore", () => {
    it("returns 200 on success", async () => {
      const res = await callPatch({ archived: false });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe("unmatched");
    });

    it("returns 404 for not_found_or_forbidden — never swallows", async () => {
      rpcError = { message: "not_found_or_forbidden", code: "P0001" };
      const res = await callPatch({ archived: false });
      expect(res.status).toBe(404);
    });
  });

  describe("authentication", () => {
    it("returns 401 without authorization header", async () => {
      const req = new Request(`http://localhost:3000/api/v1/team-praise/${PRAISE_ID}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ staffId: STAFF_ID }),
      }) as unknown as NextRequest;

      const { PATCH } = await import("@/app/api/v1/team-praise/[praiseId]/route");
      const res = await PATCH(req, { params: Promise.resolve({ praiseId: PRAISE_ID }) });
      expect(res.status).toBe(401);
    });
  });

  describe("validation", () => {
    it("returns 400 for invalid praiseId", async () => {
      const req = patchRequest({ staffId: STAFF_ID });
      const { PATCH } = await import("@/app/api/v1/team-praise/[praiseId]/route");
      const res = await PATCH(req, { params: Promise.resolve({ praiseId: "not-a-uuid" }) });
      expect(res.status).toBe(400);
    });

    it("returns 400 for empty body", async () => {
      const res = await callPatch({});
      expect(res.status).toBe(400);
    });
  });
});
