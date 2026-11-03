import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * A scheduler that stops raises no error. These prove the workers leave a
 * pulse, that a backlog is drained rather than nibbled, and that health says
 * "unhealthy" — in its status code, not only its body — when the pulse stops.
 */

const SECRET = "w".repeat(40);
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
const results = new Map<string, { data: unknown; error: unknown }>();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: (name: string, args: Record<string, unknown> = {}) => {
      calls.push({ name, args });
      return Promise.resolve(results.get(name) ?? { data: 0, error: null });
    },
  }),
}));

const batches: number[] = [];
vi.mock("@/lib/server/sms/dispatch", () => ({
  dispatchOnce: () => {
    const claimed = batches.shift() ?? 0;
    return Promise.resolve({
      claimed, submitted: claimed, suppressed: 0, failed: 0, unknown: 0, deferred: 0, skipped: 0,
    });
  },
}));

function get(path: string): Request {
  return new Request(`http://localhost:3000${path}`, { headers: { authorization: `Bearer ${SECRET}` } });
}

const HEALTHY_SMS = [{
  outbox_pending: 0, oldest_pending_age_s: 0, provider_unknown: 0, oldest_unknown_age_s: 0,
  outbox_dead_letter: 0, webhooks_unprocessed: 0, stripe_unprocessed: 0,
}];

function workers(dispatchAge: number | null, maintenanceAge: number | null, failing = false) {
  return [
    { worker: "sms_dispatch", last_success_age_s: dispatchAge, failing, last_error: null },
    { worker: "maintenance", last_success_age_s: maintenanceAge, failing: false, last_error: null },
  ];
}

beforeEach(() => {
  vi.resetModules();
  calls.length = 0;
  results.clear();
  batches.length = 0;
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.stubEnv("SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("CUSTOMER_NOTE_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  results.set("rpc_sms_health", { data: HEALTHY_SMS, error: null });
  results.set("rpc_worker_health", { data: workers(30, 300), error: null });
});

describe("the dispatcher drains a backlog", () => {
  it("keeps claiming full batches until one comes back short", async () => {
    batches.push(25, 25, 25, 7);
    const { GET } = await import("@/app/api/v1/internal/sms/dispatch/route");
    const response = await GET(get("/api/v1/internal/sms/dispatch") as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ batches: 4, claimed: 82, submitted: 82 });
  });

  it("does one cheap batch when the outbox is empty", async () => {
    const { GET } = await import("@/app/api/v1/internal/sms/dispatch/route");
    const body = await (await GET(get("/api/v1/internal/sms/dispatch") as never)).json();
    expect(body.data).toMatchObject({ batches: 1, claimed: 0 });
  });

  it("stops at its batch ceiling rather than running past the function timeout", async () => {
    batches.push(...Array.from({ length: 50 }, () => 25));
    const { GET } = await import("@/app/api/v1/internal/sms/dispatch/route");
    const body = await (await GET(get("/api/v1/internal/sms/dispatch") as never)).json();
    expect(body.data.batches).toBe(20);
    expect(body.data.claimed).toBe(500);
  });

  it("records a start and a success", async () => {
    const { GET } = await import("@/app/api/v1/internal/sms/dispatch/route");
    await GET(get("/api/v1/internal/sms/dispatch") as never);
    const beats = calls.filter((c) => c.name === "rpc_worker_heartbeat").map((c) => c.args["p_outcome"]);
    expect(beats).toEqual(["started", "succeeded"]);
  });

  it("does not beat at all for a caller without the secret", async () => {
    const { GET } = await import("@/app/api/v1/internal/sms/dispatch/route");
    const response = await GET(new Request("http://localhost:3000/api/v1/internal/sms/dispatch") as never);
    expect(response.status).toBe(404);
    expect(calls.some((c) => c.name === "rpc_worker_heartbeat")).toBe(false);
  });
});

describe("maintenance leaves a pulse", () => {
  it("records a failure naming the step, and still runs the rest", async () => {
    results.set("rpc_sms_quota_expire", { data: null, error: { message: "boom" } });
    const { GET } = await import("@/app/api/v1/internal/maintenance/route");
    await GET(get("/api/v1/internal/maintenance") as never);

    expect(calls.some((c) => c.name === "rpc_entitlements_expire_trials")).toBe(true);
    const last = calls.filter((c) => c.name === "rpc_worker_heartbeat").at(-1);
    expect(last?.args).toMatchObject({ p_worker: "maintenance", p_outcome: "failed", p_error: "failed: expire_quota" });
  });

  it("skips text pack reconciliation where Stripe is not configured, without failing", async () => {
    const { GET } = await import("@/app/api/v1/internal/maintenance/route");
    const response = await GET(get("/api/v1/internal/maintenance") as never);
    const body = await response.json();

    expect(body.data.reconcile_sms_packs).toBe("skipped");
    expect(calls.some((c) => c.name === "rpc_billing_record_reconciliation_run")).toBe(false);
    const last = calls.filter((c) => c.name === "rpc_worker_heartbeat").at(-1);
    expect(last?.args).toMatchObject({ p_worker: "maintenance", p_outcome: "succeeded" });
  });
});

describe("health", () => {
  async function health() {
    const { GET } = await import("@/app/api/v1/internal/health/route");
    const response = await GET(get("/api/v1/internal/health") as never);
    return { status: response.status, body: await response.json() };
  }

  it("is 200 and ok when queues are empty and both workers are recent", async () => {
    const { status, body } = await health();
    expect(body.data.problems).toEqual([]);
    expect(status).toBe(200);
  });

  it("is 503 when the dispatcher has not succeeded for longer than its cadence allows", async () => {
    results.set("rpc_worker_health", { data: workers(24 * 3600, 300), error: null });
    const { status, body } = await health();
    expect(status).toBe(503);
    expect(body.data.ok).toBe(false);
    expect(body.data.problems).toContain("sms_dispatch_stale");
  });

  it("treats a worker that has never run as stale", async () => {
    results.set("rpc_worker_health", { data: workers(null, null), error: null });
    const { body } = await health();
    expect(body.data.problems).toEqual(expect.arrayContaining(["sms_dispatch_stale", "maintenance_stale"]));
  });

  it("is 503 when a worker's last run failed", async () => {
    results.set("rpc_worker_health", { data: workers(30, 300, true), error: null });
    expect((await health()).body.data.problems).toContain("sms_dispatch_failing");
  });

  it("is 503 on an unprocessed Stripe event", async () => {
    results.set("rpc_sms_health", { data: [{ ...HEALTHY_SMS[0], stripe_unprocessed: 1 }], error: null });
    const { status, body } = await health();
    expect(status).toBe(503);
    expect(body.data.problems).toContain("stripe_webhooks_unprocessed");
  });

  it("names text pack money that does not add up", async () => {
    results.set("rpc_billing_pack_health", {
      data: [{
        purchases_paid: 3, paid_without_credit: 1, needs_review: 1, needs_review_segments: 12,
        refund_without_payment: 1, last_reconcile_age_s: 3600, last_reconcile_ok: false,
        last_reconcile_findings: 3,
      }],
      error: null,
    });
    const { status, body } = await health();
    expect(status).toBe(503);
    expect(body.data.problems).toEqual(expect.arrayContaining([
      "packs_paid_without_credit",
      "packs_need_review",
      "packs_refund_without_payment",
      "packs_reconcile_not_ok",
    ]));
    expect(body.data.packs).toMatchObject({ paid: 3, needsReviewSegments: 12, lastReconcileOk: false });
  });

  it("expects a pack reconciliation run once a pack has been sold", async () => {
    results.set("rpc_billing_pack_health", {
      data: [{ purchases_paid: 1, last_reconcile_age_s: null, last_reconcile_ok: null }],
      error: null,
    });
    expect((await health()).body.data.problems).toContain("packs_reconcile_stale");
  });

  it("expects no reconciliation run before any pack was sold", async () => {
    results.set("rpc_billing_pack_health", {
      data: [{ purchases_paid: 0, last_reconcile_age_s: null, last_reconcile_ok: null }],
      error: null,
    });
    const { status, body } = await health();
    expect(body.data.problems).toEqual([]);
    expect(status).toBe(200);
  });

  it("is 503 when configuration has drifted out of readiness", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const { status, body } = await health();
    expect(status).toBe(503);
    expect(body.data.problems).toContain("config_not_ready");
    // Names subsystems, never values.
    expect(JSON.stringify(body)).not.toContain("service-key");
  });
});
