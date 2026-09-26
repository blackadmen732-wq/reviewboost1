import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * getFeedbackInsights, against a fake Supabase client that records what it was
 * asked. The database side — row level security, the explicit org filter, the
 * attacks — is proven for real in supabase/tests/feedback_insights_test.sql;
 * this proves the server asks it the right question.
 */

vi.mock("server-only", () => ({}));

const calls: Array<{ kind: string; args: unknown }> = [];
let rpcResult: { data: unknown; error: unknown } = { data: [], error: null };
let probeRows: unknown[] = [];

function probeQuery() {
  const filters: Array<[string, unknown, unknown]> = [];
  const query = {
    select: (columns: string) => {
      filters.push(["select", columns, null]);
      return query;
    },
    eq: (column: string, value: unknown) => {
      filters.push(["eq", column, value]);
      return query;
    },
    lt: (column: string, value: unknown) => {
      filters.push(["lt", column, value]);
      return query;
    },
    limit: (n: number) => {
      filters.push(["limit", n, null]);
      return query;
    },
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => {
      calls.push({ kind: "probe", args: filters });
      return Promise.resolve({ data: probeRows, error: null }).then(resolve);
    },
  };
  return query;
}

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({
    rpc: async (name: string, args: unknown) => {
      calls.push({ kind: `rpc:${name}`, args });
      return rpcResult;
    },
    from: (table: string) => {
      calls.push({ kind: `from:${table}`, args: null });
      return probeQuery();
    },
  }),
  currentUser: async () => null,
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const { getFeedbackInsights } = await import("@/lib/server/owner-data");

afterEach(() => {
  calls.length = 0;
  rpcResult = { data: [], error: null };
  probeRows = [];
});

const ORG = "00000000-0000-0000-0000-00000000000a";

describe("getFeedbackInsights", () => {
  it("asks for this organization, with explicit local-midnight boundaries", async () => {
    await getFeedbackInsights(ORG, "America/New_York", { range: 90 });
    const rpc = calls.find((call) => call.kind === "rpc:rpc_feedback_insights");
    expect(rpc).toBeDefined();
    const args = rpc!.args as { p_org_id: string; p_bounds: string[]; p_location_id: string | null };
    expect(args.p_org_id).toBe(ORG);
    expect(args.p_location_id).toBeNull();
    // previous start, nine 10-day bucket starts, today, tomorrow
    expect(args.p_bounds).toHaveLength(12);
    for (const bound of args.p_bounds) {
      const clock = new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(bound));
      expect(clock).toBe("00:00");
    }
  });

  it("narrows to one location only when given one", async () => {
    await getFeedbackInsights(ORG, "UTC", { range: 7, locationId: "loc-coral" });
    const rpc = calls.find((call) => call.kind === "rpc:rpc_feedback_insights");
    expect((rpc!.args as { p_location_id: string }).p_location_id).toBe("loc-coral");
  });

  it("makes one call when the periods have ratings — no rows leave the database", async () => {
    rpcResult = {
      data: [
        { bucket: 2, rating: 5, responses: 7 },
        { bucket: 3, rating: 4, responses: 5 },
      ],
      error: null,
    };
    const insights = await getFeedbackInsights(ORG, "UTC", { range: 30 });
    expect(calls.map((call) => call.kind)).toEqual(["rpc:rpc_feedback_insights"]);
    expect(insights.current.total).toBe(12);
    expect(insights.state).toBe("full");
  });

  it("probes one row, scoped the same way, only when the periods are empty", async () => {
    probeRows = [{ id: "r1" }];
    const insights = await getFeedbackInsights(ORG, "UTC", { range: 7, locationId: "loc-coral" });
    expect(insights.state).toBe("quiet");
    const probe = calls.find((call) => call.kind === "probe");
    expect(probe?.args).toEqual(
      expect.arrayContaining([
        ["select", "id", null],
        ["eq", "org_id", ORG],
        ["eq", "location_id", "loc-coral"],
        ["limit", 1, null],
      ]),
    );
  });

  it("reports a business with no ratings at all as new", async () => {
    const insights = await getFeedbackInsights(ORG, "UTC", { range: 30 });
    expect(insights.state).toBe("none");
  });

  it("fails closed when the database refuses", async () => {
    rpcResult = { data: null, error: { code: "42501", message: "permission denied" } };
    await expect(getFeedbackInsights(ORG, "UTC", { range: 30 })).rejects.toThrow();
  });
});

describe("the Insights surfaces", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("is read-only and open to every role that can read Feedback", () => {
    const page = read("app/(owner)/feedback/insights/page.tsx");
    expect(page).toMatch(/requireOwner\("\/feedback\/insights"\)/);
    // No role gate: viewers read Insights exactly as they read Feedback.
    expect(page).not.toMatch(/permissionsFor|manage[A-Z]|role ===|editSettings/);
    const view = read("features/dashboard/insights/insights-view.tsx");
    expect(view).not.toMatch(/<form|method=|fetch\(|action=/);
  });

  it("adds no destination to the navigation", async () => {
    const { MOBILE_NAV, DESKTOP_NAV } = await import("@/features/dashboard/nav-items");
    for (const nav of [MOBILE_NAV, DESKTOP_NAV]) {
      expect(nav.map((item) => item.href)).not.toContain("/feedback/insights");
      expect(nav.map((item) => item.label).join(" ")).not.toMatch(/insight|analytic/i);
    }
    expect(MOBILE_NAV).toHaveLength(4);
  });

  it("sends the old Reviews page to Insights instead of keeping a second analytics", () => {
    const reviews = read("app/(owner)/reviews/page.tsx");
    expect(reviews).toMatch(/redirect\("\/feedback\/insights"\)/);
    expect(reviews).not.toMatch(/owner-data/);
    expect(read("lib/server/owner-data.ts")).not.toMatch(/getRatingBreakdown|recentAverage/);
  });

  it("describes Feedback as ratings, not messages the customer page never collects", () => {
    for (const path of ["app/(owner)/feedback/page.tsx", "app/(owner)/feedback/insights/page.tsx"]) {
      const page = read(path);
      expect(page, path).toContain('description="Ratings from your customers."');
      expect(page, path).not.toMatch(/Ratings and messages/);
    }
  });

  it("reads the aggregation through one function that runs as the caller", () => {
    const migration = read("../supabase/migrations/20260926000200_feedback_insights.sql");
    expect(migration).toMatch(/^security invoker$/m);
    expect(migration).toMatch(/^stable$/m);
    expect(migration).toMatch(/from public, anon, service_role;/);
    expect(migration).toMatch(/to authenticated;/);
    expect(migration).toMatch(/where r\.org_id = p_org_id/);
    expect(migration).not.toMatch(/\b(insert|update|delete)\s+(into|from|public\.)/i);
    // Ratings only: nothing about what happened after a customer left.
    expect(migration).not.toMatch(/destination_selections|google_review_clicks/);
  });
});
