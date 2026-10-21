import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();
vi.mock("@/lib/server/supabase", () => ({
  serviceRoleClient: () => ({ rpc }),
}));

const OLD_ENV = { ...process.env };
const KEY = Buffer.alloc(32, 3).toString("base64");
const OLD_KEY = Buffer.alloc(32, 4).toString("base64");
const ORG = "7c000000-0000-4000-8000-00000000000a";
const OTHER_ORG = "7c000000-0000-4000-8000-00000000000b";
const USER = "7a000000-0000-4000-8000-00000000000a";
const BINDING = { orgId: ORG, providerId: "fake", externalAccountId: "DEMO" };

beforeAll(() => {
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.PUBLIC_FRONTEND_URL = "https://app.example.com";
  process.env.INTEGRATION_CREDENTIAL_KEY = KEY;
  process.env.SMS_DEFAULT_COUNTRY_CALLING_CODE = "1";
});

afterAll(() => {
  process.env = { ...OLD_ENV };
});

beforeEach(() => {
  rpc.mockReset();
  process.env.INTEGRATIONS_FAKE_PROVIDER = "enabled";
  delete process.env.VERCEL_ENV;
  delete process.env.INTEGRATION_CREDENTIAL_KEY_VERSION;
  delete process.env.INTEGRATION_CREDENTIAL_KEY_PREVIOUS;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("provider credentials at rest", () => {
  const load = () => import("@/lib/server/integrations/credentials");

  it("round-trips and never contains the token in the clear", async () => {
    const { sealCredential, openCredential } = await load();
    const sealed = sealCredential("secret-token-value", BINDING);
    expect(sealed.startsWith("ic1:1:")).toBe(true);
    expect(sealed).not.toContain("secret-token-value");
    expect(openCredential(sealed, BINDING)).toBe("secret-token-value");
  });

  it("does not open under another business, provider or account", async () => {
    const { sealCredential, openCredential } = await load();
    const sealed = sealCredential("secret-token-value", BINDING);
    expect(() => openCredential(sealed, { ...BINDING, orgId: OTHER_ORG })).toThrow();
    expect(() => openCredential(sealed, { ...BINDING, providerId: "square" })).toThrow();
    expect(() => openCredential(sealed, { ...BINDING, externalAccountId: "OTHER" })).toThrow();
  });

  it("keeps rows sealed under the previous key readable during a rotation", async () => {
    const { sealCredential, openCredential } = await load();
    process.env.INTEGRATION_CREDENTIAL_KEY = OLD_KEY;
    const sealed = sealCredential("old-token", BINDING);

    process.env.INTEGRATION_CREDENTIAL_KEY = KEY;
    process.env.INTEGRATION_CREDENTIAL_KEY_VERSION = "2";
    process.env.INTEGRATION_CREDENTIAL_KEY_PREVIOUS = OLD_KEY;
    expect(openCredential(sealed, BINDING)).toBe("old-token");
    expect(sealCredential("new", BINDING).startsWith("ic1:2:")).toBe(true);
  });

  it("refuses to run without a key", async () => {
    const { sealCredential } = await load();
    vi.stubEnv("INTEGRATION_CREDENTIAL_KEY", "");
    expect(() => sealCredential("x", BINDING)).toThrow(/INTEGRATION_CREDENTIAL_KEY/);
  });
});

describe("registry", () => {
  const load = () => import("@/lib/server/integrations/registry");

  it("lists the test provider only where it is switched on, and never in production", async () => {
    const { listProviders, fakeProviderEnabled } = await load();
    expect(listProviders().some((p) => p.id === "fake")).toBe(true);

    process.env.INTEGRATIONS_FAKE_PROVIDER = "off";
    expect(fakeProviderEnabled()).toBe(false);

    process.env.INTEGRATIONS_FAKE_PROVIDER = "enabled";
    process.env.VERCEL_ENV = "production";
    expect(fakeProviderEnabled()).toBe(false);
    expect(listProviders().some((p) => p.id === "fake")).toBe(false);

    process.env.VERCEL_ENV = "preview";
    expect(fakeProviderEnabled()).toBe(true);
  });

  it("keeps Square as coming soon until its adapter lands", async () => {
    const { getConnectableProvider, getProvider } = await load();
    expect(getProvider("square")?.availability).toBe("in_setup");
    expect(getConnectableProvider("square")).toBeNull();
    expect(getConnectableProvider("vagaro")).toBeNull();
    expect(getConnectableProvider("fake")?.id).toBe("fake");
  });
});

describe("normalising provider customers", () => {
  const load = () => import("@/lib/server/integrations/normalize");

  it("never shows a whole number or a whole surname in a hint", async () => {
    const { displayHint } = await load();
    expect(displayHint("Ana Ruiz", "+12025550101")).toBe("Ana R. · •••• 0101");
    expect(displayHint(null, null)).toBeNull();
    expect(displayHint("Cleo", "12345")).toBe("Cleo · •••• 2345");
  });

  it("separates missing, invalid and usable phones", async () => {
    const { normalizeProviderPhone } = await load();
    expect(normalizeProviderPhone(null).kind).toBe("missing");
    expect(normalizeProviderPhone("  ").kind).toBe("missing");
    expect(normalizeProviderPhone("12345").kind).toBe("invalid");
    const ok = normalizeProviderPhone("+1 (202) 555-0102");
    expect(ok.kind).toBe("ok");
    if (ok.kind === "ok") {
      expect(ok.stored.lastFour).toBe("0102");
      expect(ok.stored.phoneEncrypted).not.toContain("5550102");
    }
  });

  it("cleans names and bounds their length", async () => {
    const { cleanName, MAX_NAME_LENGTH } = await load();
    expect(cleanName("  Ana   Ruiz ")).toBe("Ana Ruiz");
    expect(cleanName("")).toBeNull();
    expect(cleanName("x".repeat(500))?.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
  });
});

describe("the test provider", () => {
  const load = () => import("@/lib/server/integrations/providers/fake/adapter");
  const NOW = new Date("2026-10-12T15:00:00Z");
  const scopes = ["locations.read", "customers.read", "payments.read"];

  async function tokensFor(account: string) {
    const { createFakeAdapter } = await load();
    const adapter = createFakeAdapter(() => NOW);
    return { adapter, tokens: await adapter.exchangeCode({ code: `fake_${account}`, redirectUri: "x", requestedScopes: scopes }) };
  }

  it("pages visits inside the window and finds only referenced customers", async () => {
    const { adapter, tokens } = await tokensFor("DEMO");
    const ctx = { tokens, externalAccountId: "DEMO" };
    const window = { start: new Date(NOW.getTime() - 30 * 86_400_000), end: NOW };
    const all = [];
    let cursor: string | null = null;
    do {
      const page = await adapter.fetchVisits(ctx, "payments", window, cursor);
      expect(page.items.length).toBeLessThanOrEqual(4);
      all.push(...page.items);
      cursor = page.next;
    } while (cursor);
    // Visit 10 is 40 days back, outside the 30-day window.
    expect(all.map((v) => v.externalId).sort()).toEqual(["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9"].sort());
    expect(all.every((v) => v.occurredAt >= window.start && v.occurredAt <= window.end)).toBe(true);

    const customers = await adapter.fetchCustomersByIds(ctx, ["C1", "C4"]);
    expect(customers.map((c) => c.externalId).sort()).toEqual(["C1", "C4"]);
  });

  it("misbehaves on purpose for the special accounts", async () => {
    const partial = await tokensFor("PARTIAL");
    expect(partial.adapter.verifyGrant(partial.tokens, scopes)).toEqual({ sufficient: false, missing: ["payments.read"] });

    const down = await tokensFor("DOWN");
    await expect(down.adapter.discoverAccount(down.tokens)).rejects.toMatchObject({
      classification: { kind: "retryable" },
    });

    const revoked = await tokensFor("REVOKED");
    await expect(revoked.adapter.refresh(revoked.tokens)).rejects.toMatchObject({ classification: { kind: "auth" } });
  });

  it("rejects codes it did not issue", async () => {
    const { createFakeAdapter } = await load();
    await expect(
      createFakeAdapter().exchangeCode({ code: "not-a-code", redirectUri: "x", requestedScopes: scopes }),
    ).rejects.toThrow();
  });

  it("verifies webhook signatures over the address and the exact body", async () => {
    const { createFakeAdapter, signFakeWebhook, FAKE_SIGNATURE_HEADER } = await load();
    process.env.FAKE_PROVIDER_WEBHOOK_KEY = "webhook-key";
    const adapter = createFakeAdapter(() => NOW);
    const url = "https://app.example.com/api/v1/webhooks/integrations/fake";
    const body = JSON.stringify({
      event_id: "e1",
      merchant_id: "DEMO",
      type: "payment.updated",
      created_at: NOW.toISOString(),
      data: { type: "payment", id: "P2", version: 2 },
    });
    const good = new Headers({ [FAKE_SIGNATURE_HEADER]: signFakeWebhook(url, body, "webhook-key") });
    expect(adapter.verifyWebhook({ rawBody: body, headers: good, url })).toBe(true);
    expect(adapter.verifyWebhook({ rawBody: `${body} `, headers: good, url })).toBe(false);
    expect(adapter.verifyWebhook({ rawBody: body, headers: new Headers(), url })).toBe(false);

    const event = adapter.parseWebhook(body);
    expect(event).toMatchObject({ providerEventId: "e1", externalAccountId: "DEMO", objectType: "payment", objectId: "P2" });
    delete process.env.FAKE_PROVIDER_WEBHOOK_KEY;
  });
});

describe("sync backoff", () => {
  it("grows, caps at six hours, and honours a longer Retry-After", async () => {
    const { backoffSeconds } = await import("@/lib/server/integrations/sync-runner");
    const mid = () => 0.5;
    expect(backoffSeconds(0, undefined, mid)).toBe(30);
    expect(backoffSeconds(3, undefined, mid)).toBe(240);
    expect(backoffSeconds(30, undefined, mid)).toBe(6 * 60 * 60);
    expect(backoffSeconds(0, 120_000, mid)).toBe(120);
  });
});

describe("finishing a connection", () => {
  const load = () => import("@/lib/server/integrations/connection-service");
  const context = { userId: USER, orgId: ORG, role: "owner", db: {} as never };
  const pending = {
    org_id: ORG,
    provider_id: "fake",
    workflow_id: "payments",
    requested_scopes: ["locations.read", "customers.read", "payments.read"],
    code_verifier_enc: null,
    reconnect_connection_id: null,
  };

  it("refuses a state issued for another business", async () => {
    const { completeAuthorization } = await load();
    rpc.mockResolvedValueOnce({ data: [{ ...pending, org_id: OTHER_ORG }], error: null });
    await expect(
      completeAuthorization(context, "fake", { state: "s".repeat(43), code: "fake_DEMO" }, "req"),
    ).rejects.toMatchObject({ code: "oauth_state_invalid" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("refuses a state the database no longer honours", async () => {
    const { completeAuthorization } = await load();
    rpc.mockResolvedValueOnce({ data: null, error: { message: "oauth_state_invalid" } });
    await expect(
      completeAuthorization(context, "fake", { state: "s".repeat(43), code: "fake_DEMO" }, "req"),
    ).rejects.toMatchObject({ code: "oauth_state_invalid" });
  });

  it("connects nothing when the owner said no", async () => {
    const { completeAuthorization } = await load();
    rpc.mockResolvedValueOnce({ data: [pending], error: null });
    await expect(
      completeAuthorization(context, "fake", { state: "s".repeat(43), error: "access_denied" }, "req"),
    ).rejects.toMatchObject({ code: "oauth_denied" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("stores only sealed tokens, bound to this business and account", async () => {
    const { completeAuthorization } = await load();
    const { openCredential } = await import("@/lib/server/integrations/credentials");
    rpc
      .mockResolvedValueOnce({ data: [pending], error: null })
      .mockResolvedValueOnce({ data: [{ connection_id: "conn-1", state: "connecting" }], error: null });

    const result = await completeAuthorization(context, "fake", { state: "s".repeat(43), code: "fake_DEMO" }, "req");
    expect(result).toEqual({ connectionId: "conn-1", state: "connecting" });

    const [name, args] = rpc.mock.calls[1] as [string, Record<string, unknown>];
    expect(name).toBe("rpc_integration_connection_create");
    expect(args.p_org_id).toBe(ORG);
    expect(args.p_external_account_id).toBe("DEMO");
    expect(args.p_scopes_sufficient).toBe(true);
    const access = String(args.p_access_token_enc);
    expect(access).not.toMatch(/fakeat\./);
    expect(openCredential(access, BINDING)).toMatch(/^fakeat\.DEMO\./);
  });

  it("does not offer a provider that is not connectable here", async () => {
    const { startAuthorization } = await load();
    await expect(startAuthorization(context, "square", { workflowId: "payments" }, "req")).rejects.toMatchObject({
      code: "provider_unavailable",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("starts with a state whose digest, not the state, is stored", async () => {
    const { startAuthorization } = await load();
    rpc.mockResolvedValueOnce({ data: new Date().toISOString(), error: null });
    const { authorizeUrl } = await startAuthorization(context, "fake", { workflowId: "payments" }, "req");
    const url = new URL(authorizeUrl);
    const state = url.searchParams.get("state") ?? "";
    expect(state.length).toBeGreaterThanOrEqual(40);
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/settings/connections/fake/callback");
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args.p_state_digest).not.toBe(state);
    expect(args.p_org_id).toBe(ORG);
    expect(args.p_user_id).toBe(USER);
  });
});
