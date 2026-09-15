import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The endpoints nobody visits.
 *
 * Dispatch, maintenance and health are spun by a scheduler, which means their
 * only protection is a shared secret and their only witness is a log. Two
 * things are tested: that they are closed when no secret is configured — a
 * worker that falls open on missing configuration is a public outbox drain —
 * and that the scheduler's own GET reaches the same work as a POST, because a
 * cron that cannot reach the worker is a product where nothing ever sends.
 */

const rpcCalls: string[] = [];

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: (name: string) => {
      rpcCalls.push(name);
      return Promise.resolve({ data: 0, error: null });
    },
  }),
}));

vi.mock("@/lib/server/sms/dispatch", () => ({
  dispatchOnce: () => Promise.resolve({ claimed: 0, sent: 0 }),
}));

function requestWith(token: string | null, method = "GET"): Request {
  return new Request("http://localhost:3000/api/v1/internal/maintenance", {
    method,
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  });
}

beforeEach(() => {
  rpcCalls.length = 0;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  delete process.env.SMS_WORKER_SECRET;
  delete process.env.CRON_SECRET;
});

describe("worker authorization", () => {
  it("authorizes nobody when no secret is configured", async () => {
    const { workerAuthorized } = await import("@/lib/server/worker-auth");
    expect(workerAuthorized(requestWith("anything"))).toBe(false);
    expect(workerAuthorized(requestWith(null))).toBe(false);
  });

  it("accepts either our scheduler's secret or the platform's", async () => {
    process.env.SMS_WORKER_SECRET = "worker-secret-value";
    process.env.CRON_SECRET = "platform-cron-secret";
    const { workerAuthorized } = await import("@/lib/server/worker-auth");

    expect(workerAuthorized(requestWith("worker-secret-value"))).toBe(true);
    expect(workerAuthorized(requestWith("platform-cron-secret"))).toBe(true);
    expect(workerAuthorized(requestWith("neither-of-them"))).toBe(false);
  });

  it("rejects a malformed authorization header", async () => {
    process.env.SMS_WORKER_SECRET = "worker-secret-value";
    const { workerAuthorized } = await import("@/lib/server/worker-auth");

    for (const header of [
      "worker-secret-value",
      "Basic worker-secret-value",
      "Bearer worker-secret-value extra",
      "Bearer ",
    ]) {
      expect(
        workerAuthorized(
          new Request("http://localhost:3000/x", { headers: { authorization: header } }),
        ),
        header,
      ).toBe(false);
    }
  });
});

describe("maintenance", () => {
  it("looks like a route that does not exist when unauthorized", async () => {
    const { GET } = await import("@/app/api/v1/internal/maintenance/route");
    const response = await GET(requestWith("wrong") as never);

    expect(response.status).toBe(404);
    expect(rpcCalls).toEqual([]);
  });

  it("runs every step for the platform's GET, not only for a POST", async () => {
    process.env.CRON_SECRET = "platform-cron-secret";
    const { GET } = await import("@/app/api/v1/internal/maintenance/route");
    const response = await GET(requestWith("platform-cron-secret") as never);

    expect(response.status).toBe(200);
    expect(rpcCalls).toEqual([
      "rpc_sms_reconcile_aged_unknowns",
      "rpc_sms_release_dead_letters",
      "rpc_sms_quota_expire",
    ]);
  });
});

describe("the scheduled cadence", () => {
  it("drains the outbox every minute, not once a day", async () => {
    const { readFileSync } = await import("node:fs");
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons?: Array<{ path: string; schedule: string }>;
    };

    const dispatch = config.crons?.find(({ path }) => path.endsWith("/sms/dispatch"));
    expect(dispatch, "the dispatcher must be scheduled at all").toBeDefined();
    // A review request sent an hour after the visit is a different product.
    expect(dispatch?.schedule).toBe("* * * * *");

    const maintenance = config.crons?.find(({ path }) => path.endsWith("/maintenance"));
    expect(maintenance, "reconciliation must be scheduled at all").toBeDefined();
    expect(maintenance?.schedule).toMatch(/^\*\/(1|5|10|15|30) \* \* \* \*$/);
  });
});
