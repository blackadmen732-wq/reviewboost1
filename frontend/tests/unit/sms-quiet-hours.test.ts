import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const load = () => import("@/lib/server/sms/quiet-hours");

describe("quiet hours — window checks", () => {
  it("permits sending inside the local daytime window", async () => {
    const { isWithinSendWindow } = await load();
    // 12:00 UTC is inside 09:00–20:00 in UTC.
    expect(isWithinSendWindow(new Date("2026-06-15T12:00:00Z"), "UTC")).toBe(true);
    expect(isWithinSendWindow(new Date("2026-06-15T03:00:00Z"), "UTC")).toBe(false);
    expect(isWithinSendWindow(new Date("2026-06-15T20:00:00Z"), "UTC")).toBe(false); // end exclusive
  });

  it("uses the recipient's zone, not the server's", async () => {
    const { isWithinSendWindow } = await load();
    // 02:00 UTC is 22:00 the previous evening in New York (EDT) — outside.
    expect(isWithinSendWindow(new Date("2026-06-15T02:00:00Z"), "America/New_York")).toBe(false);
    // 15:00 UTC is 11:00 in New York — inside.
    expect(isWithinSendWindow(new Date("2026-06-15T15:00:00Z"), "America/New_York")).toBe(true);
  });

  it("returns the current instant unchanged when already permitted", async () => {
    const { nextAllowedSendTime } = await load();
    const now = new Date("2026-06-15T15:00:00Z");
    expect(nextAllowedSendTime(now, "UTC").toISOString()).toBe(now.toISOString());
  });
});

describe("quiet hours — next allowed time is DST-aware", () => {
  it("computes the next 09:00 local during EDT (summer, UTC-4)", async () => {
    const { nextAllowedSendTime } = await load();
    // 02:00 UTC on Jun 15 → 22:00 Jun 14 local → next open is 09:00 Jun 15 EDT = 13:00Z.
    const next = nextAllowedSendTime(new Date("2026-06-15T02:00:00Z"), "America/New_York");
    expect(next.toISOString()).toBe("2026-06-15T13:00:00.000Z");
  });

  it("computes the next 09:00 local during EST (winter, UTC-5) — a different offset", async () => {
    const { nextAllowedSendTime } = await load();
    // Same wall-clock intent, but the offset is -5 in January, proving the math
    // is not a fixed offset: 09:00 EST = 14:00Z.
    const next = nextAllowedSendTime(new Date("2026-01-15T02:00:00Z"), "America/New_York");
    expect(next.toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });

  it("opens later the same day when the current time is before the window", async () => {
    const { nextAllowedSendTime } = await load();
    // 05:00 UTC is before 09:00 UTC → same day 09:00Z.
    const next = nextAllowedSendTime(new Date("2026-06-15T05:00:00Z"), "UTC");
    expect(next.toISOString()).toBe("2026-06-15T09:00:00.000Z");
  });

  it("rolls over month boundaries", async () => {
    const { nextAllowedSendTime } = await load();
    // 30 Jun 23:00Z is past the window → next open is 1 Jul 09:00Z.
    const next = nextAllowedSendTime(new Date("2026-06-30T23:00:00Z"), "UTC");
    expect(next.toISOString()).toBe("2026-07-01T09:00:00.000Z");
  });

  it("falls back to UTC for an unknown timezone rather than throwing", async () => {
    const { isWithinSendWindow } = await load();
    expect(isWithinSendWindow(new Date("2026-06-15T12:00:00Z"), "Not/AZone")).toBe(true);
  });
});

describe("quiet hours — window validation", () => {
  it("rejects an inverted or out-of-range window", async () => {
    const { assertValidWindow } = await load();
    expect(() => assertValidWindow({ startHour: 20, endHour: 9 })).toThrow();
    expect(() => assertValidWindow({ startHour: -1, endHour: 9 })).toThrow();
    expect(() => assertValidWindow({ startHour: 9, endHour: 25 })).toThrow();
  });

  it("accepts a custom window", async () => {
    const { isWithinSendWindow } = await load();
    // 08:00 is inside a 08–21 window but outside the default 09–20.
    expect(isWithinSendWindow(new Date("2026-06-15T08:00:00Z"), "UTC", { startHour: 8, endHour: 21 })).toBe(
      true,
    );
    expect(isWithinSendWindow(new Date("2026-06-15T08:00:00Z"), "UTC")).toBe(false);
  });
});
