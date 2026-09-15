import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The door ReviewBoost owns.
 *
 * Two things are under test. The allowlist, because it is the only thing
 * standing between a compromised owner account and every printed QR code in a
 * building becoming an open redirect. And the owner write, because "changing
 * the destination must not change the Tag" is only true if exactly one
 * authorised, organization-scoped write exists.
 */

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

const rpcCalls: RpcCall[] = [];
let rpcError: { message: string } | null = null;
let membershipRows: Array<{ org_id: string; role: string }> = [];

function queryBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "order", "limit", "lt", "is", "in", "not", "eq"]) {
    builder[method] = chain;
  }
  builder["maybeSingle"] = () => Promise.resolve({ data: rows[0] ?? null, error: null });
  builder["single"] = () => Promise.resolve({ data: rows[0] ?? null, error: null });
  builder["then"] = (resolve: (v: { data: unknown; error: unknown }) => unknown) =>
    resolve({ data: rows, error: null });
  return builder;
}

function fakeClient() {
  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "user-1" } }, error: null }),
    },
    from: (table: string) => ({
      select: () => queryBuilder(table === "organization_members" ? membershipRows : []),
      update: () => queryBuilder([]),
      insert: () => queryBuilder([]),
    }),
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: rpcError });
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({ createClient: () => fakeClient() }));

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER_ORG = "22222222-2222-2222-2222-222222222222";
const LOCATION = "33333333-3333-3333-3333-333333333333";

beforeAll(() => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  process.env.PUBLIC_FRONTEND_URL = "https://app.reviewboost.test";
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
});

beforeEach(() => {
  rpcCalls.length = 0;
  rpcError = null;
  membershipRows = [{ org_id: ORG, role: "owner" }];
});

function patchSettings(body: unknown, orgHeader = ORG) {
  return new Request("http://localhost:3000/api/v1/settings", {
    method: "PATCH",
    headers: {
      authorization: "Bearer valid-session-token",
      "content-type": "application/json",
      "x-organization-id": orgHeader,
    },
    body: JSON.stringify(body),
  });
}

describe("destination allowlist", () => {
  it("accepts every Google form the product supports", async () => {
    const { isValidDestinationUrl } = await import("@/lib/server/destination");
    for (const url of [
      "https://g.page/r/CdSAMPLE/review",
      "https://maps.app.goo.gl/abc123",
      "https://search.google.com/local/writereview?placeid=ChIJabc",
      "https://www.google.com/maps/place/Somewhere",
      "https://maps.google.com/maps/place/Somewhere",
    ]) {
      expect(isValidDestinationUrl("google", url), url).toBe(true);
    }
  });

  it("refuses everything that would make a Tag dangerous", async () => {
    const { isValidDestinationUrl } = await import("@/lib/server/destination");
    for (const url of [
      "http://g.page/r/CdSAMPLE/review",
      "https://g.page:8443/r/CdSAMPLE/review",
      "https://user:pw@g.page/r/CdSAMPLE/review",
      "https://www.google.com@evil.example/maps/",
      "https://evil.example/redirect?to=https://g.page",
      "https://g.page.evil.example/r/x/review",
      "javascript:alert(1)",
      "",
    ]) {
      expect(isValidDestinationUrl("google", url), url).toBe(false);
    }
  });

  it("refuses a provider V1 has not enabled, however plausible the URL", async () => {
    const { isValidDestinationUrl } = await import("@/lib/server/destination");
    expect(isValidDestinationUrl("yelp", "https://www.yelp.com/biz/somewhere")).toBe(false);
    expect(isValidDestinationUrl("tripadvisor", "https://g.page/r/CdSAMPLE/review")).toBe(false);
    expect(isValidDestinationUrl(null, "https://g.page/r/CdSAMPLE/review")).toBe(false);
  });

  it("agrees with the client validator on every case", async () => {
    const { isValidDestinationUrl } = await import("@/lib/server/destination");
    const { isValidatedDestination } = await import("@/lib/security/destination");

    // A server that is looser serves a URL the client then rejects, and the
    // customer sees a dead flow no log explains. A server that is stricter
    // hides a real destination. Both layers have to say the same thing.
    for (const url of [
      "https://g.page/r/CdSAMPLE/review",
      "https://search.google.com/local/writereview?placeid=ChIJabc",
      "https://search.google.com/local/writereview",
      "https://www.google.com/search?q=reviews",
      "https://user:pw@g.page/r/x/review",
      "http://g.page/r/x/review",
      "not a url",
    ]) {
      expect(isValidatedDestination("google", url), url).toBe(isValidDestinationUrl("google", url));
    }
  });
});

describe("resolving a stand's destination", () => {
  it("prefers the canonical destination over the compatibility column", async () => {
    const { resolveDestination } = await import("@/lib/server/destination");
    expect(
      resolveDestination({
        destination_provider: "google",
        destination_url: "https://g.page/r/canonical/review",
        google_review_url: "https://g.page/r/stale/review",
      }),
    ).toEqual({ provider: "google", url: "https://g.page/r/canonical/review" });
  });

  it("falls back to the compatibility column for a row written before the columns existed", async () => {
    const { resolveDestination } = await import("@/lib/server/destination");
    expect(
      resolveDestination({
        destination_provider: null,
        destination_url: null,
        google_review_url: "https://g.page/r/legacy/review",
      }),
    ).toEqual({ provider: "google", url: "https://g.page/r/legacy/review" });
  });

  it("closes the door rather than serving anything that fails validation", async () => {
    const { resolveDestination } = await import("@/lib/server/destination");
    expect(
      resolveDestination({
        destination_provider: "google",
        destination_url: "https://evil.example/redirect",
        google_review_url: "https://evil.example/redirect",
      }),
    ).toBeNull();
    expect(
      resolveDestination({
        destination_provider: null,
        destination_url: null,
        google_review_url: null,
      }),
    ).toBeNull();
  });
});

describe("PATCH /api/v1/settings — the owner destination write", () => {
  it("writes through the organization-scoped destination RPC", async () => {
    const { PATCH } = await import("@/app/api/v1/settings/route");
    const response = await PATCH(
      patchSettings({
        locationId: LOCATION,
        destinationUrl: "https://g.page/r/NewPlace/review",
      }) as never,
    );

    expect(response.status).toBe(200);
    const call = rpcCalls.find(({ name }) => name === "rpc_update_location_destination");
    expect(call?.args).toEqual({
      p_org_id: ORG,
      p_location_id: LOCATION,
      p_provider: "google",
      p_url: "https://g.page/r/NewPlace/review",
    });
    // The legacy write must not be the authority for a destination change.
    expect(rpcCalls.some(({ name }) => name === "rpc_update_location")).toBe(false);
  });

  it("refuses to guess which place an owner meant", async () => {
    const { PATCH } = await import("@/app/api/v1/settings/route");
    const response = await PATCH(
      patchSettings({ destinationUrl: "https://g.page/r/NewPlace/review" }) as never,
    );

    expect(response.status).toBe(400);
    expect(rpcCalls.some(({ name }) => name === "rpc_update_location_destination")).toBe(false);
  });

  it("rejects a destination outside the allowlist before it reaches the database", async () => {
    const { PATCH } = await import("@/app/api/v1/settings/route");
    const response = await PATCH(
      patchSettings({ locationId: LOCATION, destinationUrl: "https://evil.example/redirect" }) as never,
    );

    expect(response.status).toBe(400);
    expect(rpcCalls.some(({ name }) => name === "rpc_update_location_destination")).toBe(false);
  });

  it("lets an owner clear the destination without inventing a valid one", async () => {
    const { PATCH } = await import("@/app/api/v1/settings/route");
    const response = await PATCH(
      patchSettings({ locationId: LOCATION, destinationUrl: "" }) as never,
    );

    expect(response.status).toBe(200);
    const call = rpcCalls.find(({ name }) => name === "rpc_update_location_destination");
    expect(call?.args["p_url"]).toBe("");
  });

  it("refuses a member who is not owner or admin", async () => {
    membershipRows = [{ org_id: ORG, role: "member" }];
    const { PATCH } = await import("@/app/api/v1/settings/route");
    const response = await PATCH(
      patchSettings({ locationId: LOCATION, destinationUrl: "https://g.page/r/x/review" }) as never,
    );

    expect(response.status).toBe(403);
    expect(rpcCalls.some(({ name }) => name === "rpc_update_location_destination")).toBe(false);
  });

  it("refuses an organization the caller is not a member of", async () => {
    membershipRows = [{ org_id: ORG, role: "owner" }];
    const { PATCH } = await import("@/app/api/v1/settings/route");
    const response = await PATCH(
      patchSettings(
        { locationId: LOCATION, destinationUrl: "https://g.page/r/x/review" },
        OTHER_ORG,
      ) as never,
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(rpcCalls.some(({ name }) => name === "rpc_update_location_destination")).toBe(false);
  });

  it("turns the database's own refusal into a message an owner can act on", async () => {
    rpcError = { message: 'invalid_destination_url: URL does not match' };
    const { PATCH } = await import("@/app/api/v1/settings/route");
    const response = await PATCH(
      patchSettings({ locationId: LOCATION, destinationUrl: "https://g.page/r/x/review" }) as never,
    );

    expect(response.status).toBe(400);
  });
});
