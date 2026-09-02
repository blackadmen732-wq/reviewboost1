import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const load = () => import("@/lib/server/sms/cost");
const RATE = { perSegmentMicros: 7500, currency: "USD" as const };

describe("cost preview — integer micro-units only", () => {
  it("costs a single-segment message", async () => {
    const { estimateMessageCost } = await load();
    const e = estimateMessageCost("Tap here to leave a review.", RATE);
    expect(e).toMatchObject({ encoding: "gsm7", segments: 1, totalMicros: 7500, currency: "USD" });
    expect(Number.isInteger(e.totalMicros)).toBe(true);
  });

  it("multiplies by segment count for a long message", async () => {
    const { estimateMessageCost } = await load();
    const e = estimateMessageCost("a".repeat(200), RATE); // 2 GSM segments
    expect(e.segments).toBe(2);
    expect(e.totalMicros).toBe(15000);
  });

  it("aggregates a preview across recipients", async () => {
    const { previewCost } = await load();
    const preview = previewCost(["short", "a".repeat(200)], RATE);
    expect(preview.recipients).toBe(2);
    expect(preview.totalSegments).toBe(3); // 1 + 2
    expect(preview.totalMicros).toBe(22500);
  });

  it("rejects a non-integer or negative rate", async () => {
    const { estimateMessageCost } = await load();
    expect(() => estimateMessageCost("hi", { perSegmentMicros: 7.5, currency: "USD" })).toThrow();
    expect(() => estimateMessageCost("hi", { perSegmentMicros: -1, currency: "USD" })).toThrow();
  });

  it("rejects a malformed currency", async () => {
    const { estimateMessageCost } = await load();
    expect(() => estimateMessageCost("hi", { perSegmentMicros: 1, currency: "usd" })).toThrow();
    expect(() => estimateMessageCost("hi", { perSegmentMicros: 1, currency: "US" })).toThrow();
  });

  it("rejects a rate above the safe-integer range (would lose precision)", async () => {
    const { estimateMessageCost } = await load();
    // 2^53 is an integer but not a *safe* integer.
    expect(() =>
      estimateMessageCost("hi", { perSegmentMicros: Number.MAX_SAFE_INTEGER + 1, currency: "USD" }),
    ).toThrow();
  });

  it("accepts the largest safe rate for a single segment", async () => {
    const { estimateMessageCost } = await load();
    const e = estimateMessageCost("hi", { perSegmentMicros: Number.MAX_SAFE_INTEGER, currency: "USD" });
    expect(e.segments).toBe(1);
    expect(e.totalMicros).toBe(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(e.totalMicros)).toBe(true);
  });

  it("throws rather than silently overflowing when segments push the product past MAX_SAFE_INTEGER", async () => {
    const { estimateMessageCost } = await load();
    // A body that renders to 2 segments at a rate just over half the ceiling
    // would multiply to an unsafe product — reject instead of mischarge.
    const rate = { perSegmentMicros: Math.floor(Number.MAX_SAFE_INTEGER / 2) + 10, currency: "USD" as const };
    expect(() => estimateMessageCost("a".repeat(200), rate)).toThrow(/safe integer/i);
  });

  it("throws when a preview aggregate would exceed the safe-integer range", async () => {
    const { previewCost } = await load();
    const rate = { perSegmentMicros: Math.floor(Number.MAX_SAFE_INTEGER / 3), currency: "USD" as const };
    // Four single-segment messages sum past the ceiling.
    expect(() => previewCost(["a", "b", "c", "d"], rate)).toThrow(/safe integer/i);
  });
});
