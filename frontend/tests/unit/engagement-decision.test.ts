import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { decideEngagement, DEFAULT_PROGRAM, type MemberContext } from "@/lib/server/engagement/decision";

const now = new Date("2026-11-15T17:00:00Z");
const program = { ...DEFAULT_PROGRAM, enabled: true, loyaltyEnabled: true, remindersEnabled: true, rewardLabel: "A free coffee" };
const member: MemberContext = { id: "member-1", stamps: 9, rewards: 0, remindersConsent: true,
  withdrawn: false, joinedAt: "2026-10-01T12:00:00Z", lastPurchaseAt: "2026-11-14T12:00:00Z", lastDeliveredAt: null };
// Pick a non-control identity without assuming the hash implementation.
const recipient = Array.from({ length: 100 }, (_, i) => ({ ...member, id: `member-${i}` }))
  .find((m) => decideEngagement("org-a", program, m, "America/New_York", now).kind === "draft")!;
const decide = (changes: Partial<MemberContext> = {}) => decideEngagement("org-a", program, { ...recipient, ...changes }, "America/New_York", now);

describe("engagement eligibility and creative", () => {
  it("starts disabled and suppresses after any business switch is off", () => {
    expect(decideEngagement("org-a", DEFAULT_PROGRAM, recipient, "UTC", now)).toEqual({ kind: "suppressed", reason: "disabled" });
    for (const key of ["enabled", "loyaltyEnabled", "remindersEnabled"] as const)
      expect(decideEngagement("org-a", { ...program, [key]: false }, recipient, "UTC", now).kind).toBe("suppressed");
  });
  it("never prepares a reminder after withdrawal or without consent", () => {
    expect(decide({ withdrawn: true })).toEqual({ kind: "suppressed", reason: "no_consent" });
    expect(decide({ remindersConsent: false })).toEqual({ kind: "suppressed", reason: "no_consent" });
  });
  it("enforces local quiet hours and refuses unknown timezones", () => {
    expect(decideEngagement("org-a", program, recipient, "America/New_York", new Date("2026-11-15T02:00:00Z"))).toMatchObject({ reason: "quiet_hours" });
    expect(decideEngagement("org-a", program, recipient, "invalid", now)).toMatchObject({ reason: "invalid_timezone" });
  });
  it("caps marketing to once a week, including future or invalid delivery dates", () => {
    expect(decide({ lastDeliveredAt: "2026-11-14T12:00:00Z" })).toMatchObject({ reason: "weekly_frequency_limit" });
    expect(decide({ lastDeliveredAt: "2026-12-01T12:00:00Z" }).kind).toBe("suppressed");
    expect(decide({ lastDeliveredAt: "bad" }).kind).toBe("suppressed");
  });
  it("uses actual balance and prioritizes earned rewards", () => {
    expect(decide()).toMatchObject({ campaign: "one_visit_away", delivery: "not_configured" });
    expect(decide({ rewards: 1 })).toMatchObject({ campaign: "reward_ready", body: expect.stringContaining("A free coffee") });
    expect(decide({ stamps: 2 })).toEqual({ kind: "suppressed", reason: "no_relevant_message" });
  });
  it("prepares a return reminder only after fourteen days", () => {
    expect(decide({ stamps: 2, lastPurchaseAt: "2026-10-01T12:00:00Z" })).toMatchObject({ campaign: "return_visit" });
  });
  it("rejects corrupt balances", () => {
    for (const stamps of [NaN, -1, 2.5]) expect(decide({ stamps }).kind).toBe("suppressed");
  });
  it("keeps a stable control group rather than changing assignment on refresh", () => {
    const controls = Array.from({ length: 100 }, (_, i) => ({ ...member, id: `control-${i}` }))
      .filter((m) => decideEngagement("org-a", program, m, "UTC", now).kind === "suppressed");
    expect(controls.length).toBeGreaterThan(0);
    for (const m of controls) expect(decideEngagement("org-a", program, m, "UTC", now)).toMatchObject({ reason: "control_group" });
  });
});
