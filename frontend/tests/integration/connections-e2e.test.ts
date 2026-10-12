import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { pgServiceClient, psql } from "./pg-service-client";

/**
 * Connections, end to end, against the real migrations: connect the test
 * provider, choose places, run the check, turn on, let the worker read,
 * receive a signed webhook, update now, and disconnect.
 *
 * Opt-in, because it needs the local cluster:
 *
 *   scripts/backend/local-postgres.sh reset
 *   RB_LOCAL_PG=1 npx vitest run tests/integration/connections-e2e.test.ts
 *
 * Nothing here reaches a real provider or sends a message.
 */

vi.mock("server-only", () => ({}));

const client = pgServiceClient();
vi.mock("@/lib/server/supabase", () => ({ serviceRoleClient: () => client }));

const deferred: Array<() => unknown> = [];
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => {
    deferred.push(task);
  },
}));

const enabled = process.env.RB_LOCAL_PG === "1";

const USER = "5b000000-0000-4000-8000-000000000001";
const OTHER_USER = "5b000000-0000-4000-8000-000000000002";
const ORG = "5c000000-0000-4000-8000-00000000000a";
const OTHER_ORG = "5c000000-0000-4000-8000-00000000000b";
const PLACE = "5d000000-0000-4000-8000-00000000000a";
const PLACE_TWO = "5d000000-0000-4000-8000-00000000000b";
const OTHER_PLACE = "5d000000-0000-4000-8000-00000000000c";

const ctx = { userId: USER, orgId: ORG, role: "owner", db: client as never };
const otherCtx = { userId: OTHER_USER, orgId: OTHER_ORG, role: "owner", db: client as never };

function cleanup() {
  psql(`delete from public.integration_inbox where provider_id = 'fake';
        delete from public.organizations where id in ('${ORG}', '${OTHER_ORG}');
        delete from auth.users where id in ('${USER}', '${OTHER_USER}');`);
}

const count = (sql: string) => Number(psql(sql));

describe.skipIf(!enabled)("Connections end to end (local Postgres)", () => {
  const OLD_ENV = { ...process.env };

  beforeAll(() => {
    process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    process.env.INTEGRATION_CREDENTIAL_KEY = Buffer.alloc(32, 3).toString("base64");
    process.env.PUBLIC_FRONTEND_URL = "https://app.example.com";
    process.env.INTEGRATIONS_FAKE_PROVIDER = "enabled";
    process.env.FAKE_PROVIDER_WEBHOOK_KEY = "e2e-webhook-key";
    process.env.SMS_DEFAULT_COUNTRY_CALLING_CODE = "1";
    delete process.env.VERCEL_ENV;

    // Supabase gives service_role table access through platform default
    // privileges that the local shim does not recreate; grant the reads the
    // server code makes so the cluster behaves like the hosted one.
    psql(`grant select on all tables in schema public to service_role;`);
    cleanup();
    psql(`
      insert into auth.users (id, email) values ('${USER}', 'e2e-a@example.com'), ('${OTHER_USER}', 'e2e-b@example.com');
      insert into public.organizations (id, name, slug) values ('${ORG}', 'E2E A', 'e2e-a'), ('${OTHER_ORG}', 'E2E B', 'e2e-b');
      insert into public.organization_members (org_id, user_id, role, status)
        values ('${ORG}', '${USER}', 'owner', 'active'), ('${OTHER_ORG}', '${OTHER_USER}', 'owner', 'active');
      insert into public.locations (id, org_id, name, timezone)
        values ('${PLACE}', '${ORG}', 'Main', 'UTC'), ('${PLACE_TWO}', '${ORG}', 'Second', 'UTC'), ('${OTHER_PLACE}', '${OTHER_ORG}', 'Other', 'UTC');
    `);
  });

  afterAll(() => {
    if (process.env.RB_KEEP !== "1") cleanup();
    process.env = { ...OLD_ENV };
  });

  async function drain() {
    const tasks = deferred.splice(0);
    for (const task of tasks) await task();
  }

  async function connect(context: typeof ctx, account: string) {
    const service = await import("@/lib/server/integrations/connection-service");
    const { authorizeUrl } = await service.startAuthorization(context, "fake", { workflowId: "payments" }, "e2e");
    const state = new URL(authorizeUrl).searchParams.get("state")!;
    return service.completeAuthorization(context, "fake", { state, code: `fake_${account}` }, "e2e");
  }

  let connectionId = "";

  it("connects, and a state cannot be used twice", async () => {
    const service = await import("@/lib/server/integrations/connection-service");
    const { authorizeUrl } = await service.startAuthorization(ctx, "fake", { workflowId: "payments" }, "e2e");
    const state = new URL(authorizeUrl).searchParams.get("state")!;
    const result = await service.completeAuthorization(ctx, "fake", { state, code: "fake_DEMO" }, "e2e");
    expect(result.state).toBe("connecting");
    connectionId = result.connectionId;

    await expect(service.completeAuthorization(ctx, "fake", { state, code: "fake_DEMO" }, "e2e")).rejects.toMatchObject({
      code: "oauth_state_invalid",
    });

    // Tokens are stored sealed; the plaintext shape appears nowhere.
    expect(count(`select count(*) from public.integration_credentials where connection_id = '${connectionId}' and access_token_enc like 'ic1:%'`)).toBe(1);
    expect(count(`select count(*) from public.integration_credentials where access_token_enc like '%fakeat.%'`)).toBe(0);
  });

  it("will not let a second business connect the same account", async () => {
    await expect(connect(otherCtx, "DEMO")).rejects.toMatchObject({ code: "account_already_connected" });
  });

  it("refuses to turn on before a check of the current places", async () => {
    const service = await import("@/lib/server/integrations/connection-service");
    await expect(service.activate(ctx, connectionId, "e2e")).rejects.toMatchObject({ code: "test_required" });
  });

  it("maps places, runs the check, and turns on", async () => {
    const service = await import("@/lib/server/integrations/connection-service");
    const places = await service.listProviderLocations(ORG, connectionId, "e2e");
    expect(places.map((p) => p.externalLocationId)).toEqual(["L1", "L2"]);

    await expect(
      service.saveConfiguration(ctx, connectionId, { mappings: [{ externalLocationId: "NOPE", locationId: PLACE }] }, "e2e"),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      service.saveConfiguration(ctx, connectionId, { mappings: [{ externalLocationId: "L1", locationId: OTHER_PLACE }] }, "e2e"),
    ).rejects.toBeTruthy();

    await service.saveConfiguration(ctx, connectionId, { mappings: [{ externalLocationId: "L1", locationId: PLACE }] }, "e2e");
    const check = await service.runTest(ctx, connectionId, "e2e");
    expect(check.passed).toBe(true);
    expect(check.summary.visitsFound).toBeGreaterThan(0);
    expect(count(`select count(*) from public.customers where org_id = '${ORG}'`)).toBe(0);

    const { queuedRuns } = await service.activate(ctx, connectionId, "e2e");
    expect(queuedRuns).toBe(1);
    expect(deferred.length).toBe(0);
  });

  it("reads the last 30 days: contacts by phone, visits at chosen places, issues for the rest", async () => {
    const { processIntegrations } = await import("@/lib/server/integrations/sync-runner");
    await processIntegrations({ budgetMs: 30_000, worker: "e2e" });

    expect(psql(`select status from public.integration_sync_runs where connection_id = '${connectionId}' and kind = 'backfill'`)).toBe(
      "partial",
    );
    // C1 and C6 share one number, so they are one contact; C2 is another.
    expect(count(`select count(*) from public.customers where org_id = '${ORG}'`)).toBe(2);
    expect(count(`select count(*) from public.customer_visits where org_id = '${ORG}' and location_id = '${PLACE}'`)).toBe(4);
    expect(count(`select count(*) from public.customer_visits where org_id = '${ORG}' and location_id <> '${PLACE}'`)).toBe(0);
    const issues = psql(
      `select string_agg(distinct issue_code, ',' order by issue_code) from public.integration_record_issues where connection_id = '${connectionId}' and resolved_at is null`,
    );
    // Visits at the place left out are not issues: that was the owner's choice.
    expect(issues.split(",")).toEqual(["customer_not_reachable", "no_phone"]);
    // Hints never hold a whole number.
    expect(count(`select count(*) from public.integration_record_issues where display_hint ~ '[0-9]{5,}'`)).toBe(0);
    expect(psql(`select health || ':' || array_to_string(warning_codes, ',') from public.integration_connections where id = '${connectionId}'`)).toBe(
      "warning:records_skipped",
    );
    // Nothing was texted and no consent was invented.
    expect(count(`select count(*) from public.sms_consent_events where org_id = '${ORG}'`)).toBe(0);
  });

  it("is idempotent: running the worker again changes nothing", async () => {
    const { processIntegrations } = await import("@/lib/server/integrations/sync-runner");
    const before = psql(`select count(*) || '/' || (select count(*) from public.customer_visits where org_id = '${ORG}') from public.customers where org_id = '${ORG}'`);
    await processIntegrations({ budgetMs: 10_000, worker: "e2e-2" });
    expect(psql(`select count(*) || '/' || (select count(*) from public.customer_visits where org_id = '${ORG}') from public.customers where org_id = '${ORG}'`)).toBe(
      before,
    );
  });

  it("accepts a signed webhook once, rejects an unsigned one, and applies it", async () => {
    const { POST } = await import("@/app/api/v1/webhooks/integrations/[provider]/route");
    const { signFakeWebhook, FAKE_SIGNATURE_HEADER } = await import("@/lib/server/integrations/providers/fake/adapter");
    const url = "https://app.example.com/api/v1/webhooks/integrations/fake";
    const body = JSON.stringify({
      event_id: "e2e-evt-1",
      merchant_id: "DEMO",
      type: "payment.updated",
      created_at: new Date().toISOString(),
      data: { type: "payment", id: "P2", version: 2 },
    });
    const send = (signature: string | null) =>
      POST(
        new Request("http://internal-host/api/v1/webhooks/integrations/fake", {
          method: "POST",
          body,
          headers: signature ? { [FAKE_SIGNATURE_HEADER]: signature } : {},
        }) as never,
        { params: Promise.resolve({ provider: "fake" }) },
      );

    expect((await send(null)).status).toBe(403);
    const signature = signFakeWebhook(url, body, "e2e-webhook-key");
    const first = await send(signature);
    expect(first.status).toBe(200);
    const second = await send(signature);
    expect(((await second.json()) as { data: { duplicate: boolean } }).data.duplicate).toBe(true);

    expect(count(`select count(*) from public.integration_inbox where provider_event_id = 'e2e-evt-1' and body_encrypted not like '%merchant_id%'`)).toBe(1);
    await drain();
    expect(psql(`select status from public.integration_inbox where provider_event_id = 'e2e-evt-1'`)).toBe("processed");
  });

  it("shares one manual update between quick repeated taps", async () => {
    const service = await import("@/lib/server/integrations/connection-service");
    const first = await service.syncNow(ctx, connectionId, "e2e");
    const second = await service.syncNow(ctx, connectionId, "e2e");
    expect(first.created).toBe(true);
    expect(second).toEqual({ runId: first.runId, created: false });
    await expect(service.syncNow(otherCtx, connectionId, "e2e")).rejects.toMatchObject({ code: "not_found" });
  });

  it("disconnects: stops, deletes the keys, keeps data for 30 days", async () => {
    const service = await import("@/lib/server/integrations/connection-service");
    await expect(service.disconnect(otherCtx, connectionId, "e2e")).rejects.toMatchObject({ code: "not_found" });

    const result = await service.disconnect(ctx, connectionId, "e2e");
    expect(result).toEqual({ state: "disconnected", revoked: true });
    expect(count(`select count(*) from public.integration_credentials where connection_id = '${connectionId}'`)).toBe(0);
    expect(count(`select count(*) from public.integration_sync_runs where connection_id = '${connectionId}' and status in ('queued', 'running')`)).toBe(0);
    expect(count(`select count(*) from public.integration_connections where id = '${connectionId}' and purge_after > now() + interval '29 days'`)).toBe(1);
    expect(count(`select count(*) from public.customers where org_id = '${ORG}'`)).toBe(2);

    // Now the account is free for another business.
    const other = await connect(otherCtx, "DEMO");
    expect(other.state).toBe("connecting");
  });

  it("puts an account with missing permission in 'needs permission'", async () => {
    psql(`delete from public.integration_connections where org_id = '${OTHER_ORG}'`);
    const result = await connect(otherCtx, "PARTIAL");
    expect(result.state).toBe("authorization_required");
  });
});
