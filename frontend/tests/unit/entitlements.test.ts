import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  locationLimitOf,
  tagLimitOf,
  type EntitlementStatus,
  type PlanId,
} from "@/lib/owner/entitlement-limits";

const MIGRATION = readFileSync(
  join(process.cwd(), "..", "supabase", "migrations", "20260914000300_entitlements_and_tag_limits.sql"),
  "utf8",
);

/** Pull `when 'growth' then 8` out of the named SQL function's body. */
function sqlLimits(functionName: string): Record<string, number> {
  const start = MIGRATION.indexOf(`function app.${functionName}(`);
  expect(start, `${functionName} is missing from the migration`).toBeGreaterThan(-1);
  const body = MIGRATION.slice(start, MIGRATION.indexOf("$$;", start));

  const limits: Record<string, number> = {};
  for (const [, key, value] of body.matchAll(/when '([a-z_]+)'\s+then (\d+)/g)) {
    limits[key as string] = Number(value);
  }
  return limits;
}

describe("entitlement limits match the database", () => {
  // The TypeScript copy exists so the UI can render "2 of 3" without a round
  // trip. The database is the authority, and a disagreement between them is
  // the bug this test exists to catch: the route would allow a Tag the RPC
  // then refuses, or refuse one it would have allowed.
  it("uses the same per-plan Tag limits as app.plan_tag_limit", () => {
    const sql = sqlLimits("plan_tag_limit");
    expect(sql).toEqual({ starter: 3, growth: 8, pro: 25 });

    for (const [plan, expected] of Object.entries(sql)) {
      expect(tagLimitOf(plan as PlanId, "active"), plan).toBe(expected);
    }
  });

  it("uses the same per-plan location limits as app.plan_location_limit", () => {
    const sql = sqlLimits("plan_location_limit");
    expect(sql).toEqual({ starter: 1, growth: 2, pro: 5 });

    for (const [plan, expected] of Object.entries(sql)) {
      expect(locationLimitOf(plan as PlanId, "active"), plan).toBe(expected);
    }
  });

  it("gives a trial one Tag and one location, whatever plan is named", () => {
    const sql = sqlLimits("entitlement_tag_limit");
    expect(sql["trialing"]).toBe(1);

    for (const plan of [null, "starter", "growth", "pro"] as const) {
      expect(tagLimitOf(plan, "trialing"), String(plan)).toBe(1);
      expect(locationLimitOf(plan, "trialing"), String(plan)).toBe(1);
    }
  });
});

describe("a missing or unpaid entitlement is never generous", () => {
  it("gives an organization with no plan nothing on an active status", () => {
    // `active` with no plan should be unreachable -- the table has a check
    // constraint forbidding it -- but if it ever happens, the answer is zero,
    // not "the cheapest paid plan".
    expect(tagLimitOf(null, "active")).toBe(0);
    expect(locationLimitOf(null, "active")).toBe(0);
  });

  it.each(["past_due", "cancelled", "suspended"] satisfies EntitlementStatus[])(
    "mints no new Tags while %s, on any plan",
    (status) => {
      for (const plan of ["starter", "growth", "pro"] as const) {
        expect(tagLimitOf(plan, status), plan).toBe(0);
      }
      // And never silently becomes a free plan: there is no free plan, so the
      // answer is zero new Tags, not "Starter". The Tags already printed are
      // untouched -- the cap only applies to creating another.
      expect(tagLimitOf(null, status)).toBe(0);
    },
  );

  it("refuses a status the database would refuse", () => {
    const declared = MIGRATION.match(/check \(status in \(([^)]+)\)\)/);
    expect(declared, "the status check constraint is missing").not.toBeNull();

    const statuses = [...(declared?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(statuses.sort()).toEqual([
      "active",
      "cancelled",
      "past_due",
      "suspended",
      "trialing",
    ]);
  });
});

describe("the snapshot carries no billing", () => {
  it("has no SMS allowance, price, or credit column", () => {
    // Absent, not zero. This table does not get an opinion about SMS until the
    // money change lands the catalog, Stripe, and the ledger together, and a
    // column here now is a number that will disagree with the one that charges
    // people.
    const table = MIGRATION.slice(
      MIGRATION.indexOf("create table public.entitlement_snapshots"),
      MIGRATION.indexOf("comment on table public.entitlement_snapshots"),
    );
    for (const forbidden of ["sms", "price", "amount", "micros", "credit"]) {
      expect(table.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("will not let a paid status exist without a plan", () => {
    expect(MIGRATION).toContain("entitlement_active_requires_plan");
    expect(MIGRATION).toContain("check (status <> 'active' or plan_id is not null)");
  });

  it("gives the status column no default", () => {
    // A default is how "nobody checked" becomes "active".
    const statusLine = MIGRATION.slice(
      MIGRATION.indexOf("    status  "),
      MIGRATION.indexOf("trial_started_at"),
    );
    expect(statusLine).not.toContain("default");
  });
});

describe("the Tag cap lives in the database", () => {
  it("locks the entitlement row before counting, not after", () => {
    const fn = MIGRATION.slice(
      MIGRATION.indexOf("function app.lock_entitlement("),
      MIGRATION.indexOf("$$;", MIGRATION.indexOf("function app.lock_entitlement(")),
    );
    expect(fn).toContain("for update");

    const create = MIGRATION.slice(MIGRATION.indexOf("function public.rpc_create_stand("));
    const lockAt = create.indexOf("app.lock_entitlement(p_org_id)");
    const countAt = create.indexOf("select count(*) into v_used");
    expect(lockAt, "rpc_create_stand does not take the lock").toBeGreaterThan(-1);
    // Counting before locking is the bug: two requests both read "2 of 3" and
    // both insert. The order is the whole guarantee.
    expect(countAt).toBeGreaterThan(lockAt);
  });

  it("counts every Tag that is not retired", () => {
    expect(MIGRATION).toContain("and status <> 'retired'");
  });

  it("refuses to create a Tag with no reprint ciphertext", () => {
    expect(MIGRATION).toContain("reprint_ciphertext_required");
  });
});
