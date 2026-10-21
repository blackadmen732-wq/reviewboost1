import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Loading a connection for the worker: one scoped service-role call, and a
 * token refresh that fails for a moment never hands out an expired token
 * (which the provider would refuse as an auth failure, asking the owner to
 * sign in again over an outage).
 */

const adapter = {
  shouldRefresh: vi.fn(() => true),
  refresh: vi.fn(),
  classifyError: vi.fn((caught: unknown) => (caught as { classification: unknown }).classification),
};
vi.mock("@/lib/server/integrations/adapters", () => ({ getAdapter: () => adapter }));

const ORG = "7c000000-0000-4000-8000-00000000000a";
const CONNECTION = "7d000000-0000-4000-8000-0000000000c1";
const BINDING = { orgId: ORG, providerId: "fake", externalAccountId: "DEMO" };
const NOW = new Date("2026-10-20T12:00:00Z");
const OLD_ENV = { ...process.env };

beforeAll(() => {
  process.env.INTEGRATION_CREDENTIAL_KEY = Buffer.alloc(32, 3).toString("base64");
  process.env.INTEGRATIONS_FAKE_PROVIDER = "enabled";
});
afterAll(() => {
  process.env = { ...OLD_ENV };
});

const rpc = vi.fn();
const svc = { rpc } as never;

async function rowWith(accessExpiresAt: Date | null) {
  const { sealTokens } = await import("@/lib/server/integrations/credentials");
  const sealed = sealTokens(
    { accessToken: "at-old", refreshToken: "rt-old", accessExpiresAt, refreshExpiresAt: null, grantedScopes: [] },
    BINDING,
  );
  return {
    id: CONNECTION,
    org_id: ORG,
    provider_id: "fake",
    workflow_id: "payments",
    external_account_id: "DEMO",
    state: "active",
    granted_scopes: ["payments.read"],
    access_token_enc: sealed.accessTokenEnc,
    refresh_token_enc: sealed.refreshTokenEnc,
    access_expires_at: sealed.accessExpiresAt,
    refresh_expires_at: null,
    last_refreshed_at: null,
    mapped_location_ids: ["LOC-1", "LOC-2"],
  };
}

function answer(row: unknown, locked = true) {
  rpc.mockImplementation(async (name: string) => {
    if (name === "rpc_integration_load_connection") return { data: row ? [row] : [], error: null };
    if (name === "rpc_integration_lock_refresh") return { data: locked, error: null };
    return { data: null, error: null };
  });
}

const transient = { classification: { kind: "retryable", reason: "server_error" } };

beforeEach(() => {
  rpc.mockReset();
  adapter.refresh.mockReset();
  adapter.shouldRefresh.mockReturnValue(true);
});

describe("loadConnection", () => {
  const load = () => import("@/lib/server/integrations/pipeline");

  it("reads through the one scoped function, naming the business", async () => {
    adapter.shouldRefresh.mockReturnValue(false);
    answer(await rowWith(new Date(NOW.getTime() + 3_600_000)));
    const { loadConnection } = await load();
    const loaded = await loadConnection(svc, ORG, CONNECTION, NOW);
    expect(rpc).toHaveBeenCalledWith("rpc_integration_load_connection", { p_org_id: ORG, p_connection_id: CONNECTION });
    expect(loaded.ctx.tokens.accessToken).toBe("at-old");
    expect([...loaded.mappedLocations]).toEqual(["LOC-1", "LOC-2"]);
  });

  it("finds nothing for another business's connection", async () => {
    answer(null);
    const { loadConnection } = await load();
    await expect(loadConnection(svc, ORG, CONNECTION, NOW)).rejects.toMatchObject({ code: "connection_not_found" });
  });

  it("says when the tokens are missing", async () => {
    answer({ ...(await rowWith(null)), access_token_enc: null });
    const { loadConnection } = await load();
    await expect(loadConnection(svc, ORG, CONNECTION, NOW)).rejects.toMatchObject({ code: "credentials_missing" });
  });

  it("keeps a still-valid token when a refresh fails for a moment", async () => {
    answer(await rowWith(new Date(NOW.getTime() + 60_000)));
    adapter.refresh.mockRejectedValue(transient);
    const { loadConnection } = await load();
    const loaded = await loadConnection(svc, ORG, CONNECTION, NOW);
    expect(loaded.ctx.tokens.accessToken).toBe("at-old");
  });

  it("never hands out an expired token when the refresh fails for a moment", async () => {
    answer(await rowWith(new Date(NOW.getTime() - 60_000)));
    adapter.refresh.mockRejectedValue(transient);
    const { loadConnection } = await load();
    await expect(loadConnection(svc, ORG, CONNECTION, NOW)).rejects.toMatchObject({
      classification: { kind: "retryable" },
    });
    expect(rpc).toHaveBeenCalledWith("rpc_integration_report_outcome", expect.objectContaining({ p_outcome: "retryable" }));
  });

  it("waits rather than use an expired token while another worker refreshes", async () => {
    answer(await rowWith(new Date(NOW.getTime() - 60_000)), false);
    const { loadConnection } = await load();
    await expect(loadConnection(svc, ORG, CONNECTION, NOW)).rejects.toMatchObject({
      classification: { kind: "retryable" },
    });
    expect(adapter.refresh).not.toHaveBeenCalled();
  });

  it("asks the owner to sign in again only when the provider refuses the refresh", async () => {
    answer(await rowWith(new Date(NOW.getTime() - 60_000)));
    adapter.refresh.mockRejectedValue({ classification: { kind: "auth", reason: "token_revoked" } });
    const { loadConnection } = await load();
    await expect(loadConnection(svc, ORG, CONNECTION, NOW)).rejects.toMatchObject({ classification: { kind: "auth" } });
    expect(rpc).toHaveBeenCalledWith("rpc_integration_report_outcome", expect.objectContaining({ p_outcome: "auth" }));
  });
});
