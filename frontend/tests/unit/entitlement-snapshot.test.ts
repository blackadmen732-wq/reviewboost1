import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The owner-facing snapshot must say what the database will enforce. It used
 * to call a missing or planless row "active Starter, 3 Tags".
 */

const past = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
const future = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();

describe("owner entitlement snapshot", () => {
  it("fails closed with no row: setup allowance, not an invented Starter plan", async () => {
    const { snapshotFromRow } = await import("@/lib/server/entitlements-service");
    const s = snapshotFromRow(null, 1, 1);
    expect(s.tagLimit).toBe(1);
    expect(s.canCreateTag).toBe(false);
  });

  it("gives a planless trial the trial allowance", async () => {
    const { snapshotFromRow } = await import("@/lib/server/entitlements-service");
    const s = snapshotFromRow({ plan_id: null, status: "trialing", trial_ends_at: future }, 0, 0);
    expect(s.tagLimit).toBe(1);
    expect(s.canCreateTag).toBe(true);
  });

  it("closes an expired trial, whatever the stored status says", async () => {
    const { snapshotFromRow } = await import("@/lib/server/entitlements-service");
    const s = snapshotFromRow({ plan_id: "growth", status: "trialing", trial_ends_at: past }, 0, 0);
    expect(s.tagLimit).toBe(0);
    expect(s.canCreateTag).toBe(false);
  });

  it("keeps a grandfathered business working with what it has", async () => {
    const { snapshotFromRow } = await import("@/lib/server/entitlements-service");
    const s = snapshotFromRow({ plan_id: null, status: "legacy", trial_ends_at: null }, 1, 1);
    expect(s.tagLimit).toBe(1);
    expect(s.canUseSoftware).toBe(true);
    expect(s.canCreateTag).toBe(false);
  });

  it("uses the paid plan's limits only when active", async () => {
    const { snapshotFromRow } = await import("@/lib/server/entitlements-service");
    expect(snapshotFromRow({ plan_id: "pro", status: "active", trial_ends_at: null }, 0, 24).canCreateTag).toBe(true);
    expect(snapshotFromRow({ plan_id: "pro", status: "suspended", trial_ends_at: null }, 0, 0).tagLimit).toBe(0);
  });

  it("marks a cancelled business cancelled", async () => {
    const { snapshotFromRow } = await import("@/lib/server/entitlements-service");
    const s = snapshotFromRow({ plan_id: "starter", status: "cancelled", trial_ends_at: null }, 0, 0);
    expect(s.tags).toBe("cancelled");
    expect(s.canUseSoftware).toBe(false);
  });
});

describe("legacy in the server model", () => {
  it("serves customers and never expires", async () => {
    const { allowsService, effectiveStatus, tagLimit } = await import("@/lib/server/entitlements");
    expect(allowsService("legacy")).toBe(true);
    expect(effectiveStatus("legacy", null)).toBe("legacy");
    expect(tagLimit(null, "legacy")).toBe(1);
  });
});
