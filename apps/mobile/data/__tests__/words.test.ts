import { describe, expect, it } from "vitest";
import { clock, lastUsedLabel, plural, relativeDay, tagChecks, tagReadiness, textStatus } from "../../lib/words";

/** The iPhone says days, times and Tag states in the website's words. */
const NOW = Date.parse("2026-11-02T18:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("days and times", () => {
  it("counts days the way the website's lists do", () => {
    expect(relativeDay(daysAgo(0), NOW)).toBe("Today");
    expect(relativeDay(daysAgo(1), NOW)).toBe("Yesterday");
    expect(relativeDay(daysAgo(5), NOW)).toBe("5 days ago");
    expect(relativeDay("2026-10-22T12:00:00Z", NOW)).toBe("Oct 22");
  });

  it("tells the time in the business's own time zone", () => {
    expect(clock("2026-11-02T12:30:00Z", "America/New_York")).toBe("7:30 AM");
    expect(clock("2026-11-02T12:30:00Z", "Not/AZone")).toBe("12:30 PM");
  });

  it("says when a Tag was last used", () => {
    expect(lastUsedLabel(null, NOW)).toBe("Not used yet");
    expect(lastUsedLabel(daysAgo(0), NOW)).toBe("Used today");
    expect(lastUsedLabel(daysAgo(3), NOW)).toBe("Used 3 days ago");
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
    expect(tagChecks(fresh)).toEqual({ qr: { ok: true, label: "QR ready" }, nfc: { ok: false, label: "Program NFC" } });
    expect(tagChecks(programmed)).toEqual({ qr: { ok: true, label: "QR ready" }, nfc: { ok: true, label: "NFC ready" } });
    expect(tagChecks(rotated)).toEqual({ qr: { ok: false, label: "Reprint QR" }, nfc: { ok: false, label: "Reprogram NFC" } });
    expect(tagReadiness(rotated)).toBe("both");
  });
});

describe("text statuses", () => {
  it("uses the website's words, and never hides an unknown status", () => {
    expect(textStatus("delivered").label).toBe("Delivered");
    expect(textStatus("suppressed").label).toBe("Not sent · opted out or blocked");
    expect(textStatus("something_new").label).toBe("something_new");
  });
});
