import { describe, expect, it } from "vitest";
import { clock, lastUsedLabel, plural, relativeDay, tagChecks, tagReadiness, tagReadinessLabel, textStatus } from "../../lib/words";

/** The iPhone says days, times and Tag states in the website's words. */
const NOW = Date.parse("2026-11-02T18:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("days and times", () => {
  it("counts days the way the website's lists do", () => {
    expect(relativeDay(daysAgo(0), "UTC", NOW)).toBe("Today");
    expect(relativeDay(daysAgo(1), "UTC", NOW)).toBe("Yesterday");
    expect(relativeDay(daysAgo(5), "UTC", NOW)).toBe("5 days ago");
    expect(relativeDay("2026-10-22T12:00:00Z", "UTC", NOW)).toBe("Oct 22");
  });

  /**
   * It counted 24-hour periods, so last night's rating, read the next
   * morning, was "Today at 6:00 PM". Days are the business's calendar days,
   * as on the website.
   */
  it("counts the business's calendar days, not 24-hour periods", () => {
    const nextMorning = Date.parse("2026-11-03T09:00:00-05:00");
    expect(relativeDay("2026-11-02T18:00:00-05:00", "America/New_York", nextMorning)).toBe("Yesterday");
    expect(relativeDay("2026-11-03T00:30:00-05:00", "America/New_York", nextMorning)).toBe("Today");
    expect(relativeDay("2026-11-01T10:00:00-05:00", "America/New_York", nextMorning)).toBe("2 days ago");
    // 01:30 UTC on 3 Nov is the evening of 2 Nov in New York, the night of 3 Nov in London.
    const morning = Date.parse("2026-11-03T14:00:00Z");
    expect(relativeDay("2026-11-03T01:30:00Z", "America/New_York", morning)).toBe("Yesterday");
    expect(relativeDay("2026-11-03T01:30:00Z", "Europe/London", morning)).toBe("Today");
    expect(relativeDay("2026-10-20T02:00:00Z", "America/Los_Angeles", morning)).toBe("Oct 19");
  });

  it("falls back to UTC for a zone the phone does not know, like the clock", () => {
    expect(relativeDay("2026-11-03T01:30:00Z", "Not/AZone", Date.parse("2026-11-03T14:00:00Z"))).toBe("Today");
  });

  it("tells the time in the business's own time zone", () => {
    expect(clock("2026-11-02T12:30:00Z", "America/New_York")).toBe("7:30 AM");
    expect(clock("2026-11-02T12:30:00Z", "Not/AZone")).toBe("12:30 PM");
  });

  it("says when a Tag was last used", () => {
    expect(lastUsedLabel(null, "UTC", NOW)).toBe("Not used yet");
    expect(lastUsedLabel(daysAgo(0), "UTC", NOW)).toBe("Used today");
    expect(lastUsedLabel(daysAgo(3), "UTC", NOW)).toBe("Used 3 days ago");
    // Opened last night: yesterday, though fewer than 24 hours ago.
    const nextMorning = Date.parse("2026-11-03T09:00:00-05:00");
    expect(lastUsedLabel("2026-11-02T20:00:00-05:00", "America/New_York", nextMorning)).toBe("Used yesterday");
    expect(lastUsedLabel("2026-10-12T23:30:00-04:00", "America/New_York", nextMorning)).toBe("Used Oct 12");
  });

  it("writes counts as words", () => {
    expect(plural(1, "rating")).toBe("1 rating");
    expect(plural(1200, "text")).toBe("1,200 texts");
  });
});

describe("Tag checks", () => {
  const fresh = { nfcProvisionedAt: null, tokenRotatedAt: null };
  const programmed = { nfcProvisionedAt: "2026-10-01T00:00:00Z", tokenRotatedAt: null };
  const rotated = { nfcProvisionedAt: "2026-10-01T00:00:00Z", tokenRotatedAt: "2026-10-10T00:00:00Z" };

  it("shows the printed code and the chip separately, because they fail separately", () => {
    expect(tagChecks(fresh)).toEqual({ qr: { ok: true, label: "QR ready" }, nfc: { ok: false, label: "Set up tap" } });
    expect(tagChecks(programmed)).toEqual({ qr: { ok: true, label: "QR ready" }, nfc: { ok: true, label: "Tap ready" } });
    expect(tagChecks(rotated)).toEqual({ qr: { ok: false, label: "Reprint QR" }, nfc: { ok: false, label: "Set up tap again" } });
    expect(tagReadiness(rotated)).toBe("both");
  });
});

describe("Tag status words", () => {
  it("says what the website says, status first", () => {
    expect(tagReadinessLabel("ready")).toBe("Ready");
    expect(tagReadinessLabel("needs-nfc")).toBe("Tap not set up");
    expect(tagReadinessLabel("needs-qr")).toBe("Reprint the code");
    expect(tagReadinessLabel("both")).toBe("Code changed: reprint and set up tap");
  });
});

describe("text statuses", () => {
  it("uses the website's words, and never hides an unknown status", () => {
    expect(textStatus("delivered").label).toBe("Delivered");
    expect(textStatus("suppressed").label).toBe("Not sent · opted out or blocked");
    expect(textStatus("something_new").label).toBe("something_new");
  });
});
