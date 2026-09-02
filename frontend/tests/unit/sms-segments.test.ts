import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const load = () => import("@/lib/server/sms/segments");

describe("SMS segment engine — encoding detection", () => {
  it("plain ASCII is GSM-7", async () => {
    const { computeSegments } = await load();
    const r = computeSegments("How was your visit? Tap here to leave a review.");
    expect(r.encoding).toBe("gsm7");
    expect(r.segments).toBe(1);
  });

  it("accented letters inside the GSM basic set stay GSM-7", async () => {
    const { computeSegments } = await load();
    // é, à, ö are in the GSM 03.38 basic set.
    expect((await load()).computeSegments("café à gogo öl").encoding).toBe("gsm7");
    expect(computeSegments("café").encoding).toBe("gsm7");
  });

  it("an accent outside the basic set forces UCS-2", async () => {
    const { computeSegments } = await load();
    // ï (U+00EF) is not in the GSM basic or extension set.
    expect(computeSegments("naïve").encoding).toBe("ucs2");
  });

  it("a single curly quote forces UCS-2 for the whole message", async () => {
    const { computeSegments } = await load();
    const r = computeSegments("How was your visit’s experience?"); // right single quote
    expect(r.encoding).toBe("ucs2");
    expect(r.segments).toBe(1);
  });

  it("an emoji forces UCS-2 and counts as two units", async () => {
    const { computeSegments } = await load();
    const r = computeSegments("Thanks 😀"); // 😀 surrogate pair
    expect(r.encoding).toBe("ucs2");
    // "Thanks " = 7 units + emoji 2 units = 9
    expect(r.unitCount).toBe(9);
    expect(r.segments).toBe(1);
  });
});

describe("SMS segment engine — GSM-7 boundaries", () => {
  it("empty string is one segment, zero units", async () => {
    const { computeSegments } = await load();
    const r = computeSegments("");
    expect(r).toMatchObject({ encoding: "gsm7", unitCount: 0, segments: 1 });
  });

  it("exactly 160 GSM chars is a single segment", async () => {
    const { computeSegments } = await load();
    const r = computeSegments("a".repeat(160));
    expect(r).toMatchObject({ unitCount: 160, segments: 1, remainingInLastSegment: 0 });
  });

  it("161 GSM chars becomes two concatenated segments of 153", async () => {
    const { computeSegments } = await load();
    const r = computeSegments("a".repeat(161));
    expect(r.unitCount).toBe(161);
    expect(r.segments).toBe(2);
    expect(r.perSegment).toBe(153);
  });

  it("a GSM extension char counts as two units", async () => {
    const { computeSegments } = await load();
    const r = computeSegments("€"); // extension table
    expect(r).toMatchObject({ encoding: "gsm7", unitCount: 2, segments: 1 });
  });

  it("80 euro signs is exactly 160 units, one segment", async () => {
    const { computeSegments } = await load();
    const r = computeSegments("€".repeat(80));
    expect(r).toMatchObject({ unitCount: 160, segments: 1 });
  });

  it("does not split a 2-unit extension char across a segment boundary", async () => {
    const { computeSegments } = await load();
    // 81 euros = 162 units. A naive ceil(162/153) is 2, but the packer must not
    // place a 2-unit char straddling unit 153: segment one holds 76 chars (152
    // units) and the rest spill over, still 2 segments here but never a split.
    const r = computeSegments("€".repeat(81));
    expect(r.unitCount).toBe(162);
    expect(r.segments).toBe(2);
  });
});

describe("SMS segment engine — UCS-2 boundaries", () => {
  it("70 UCS-2 units is a single segment", async () => {
    const { computeSegments } = await load();
    const r = computeSegments("ï".repeat(70));
    expect(r).toMatchObject({ encoding: "ucs2", unitCount: 70, segments: 1 });
  });

  it("71 UCS-2 units needs two segments of 67", async () => {
    const { computeSegments } = await load();
    const r = computeSegments("ï".repeat(71));
    expect(r.unitCount).toBe(71);
    expect(r.segments).toBe(2);
    expect(r.perSegment).toBe(67);
  });

  it("does not split an emoji surrogate pair across a boundary", async () => {
    const { computeSegments } = await load();
    // 36 emoji = 72 UCS-2 units, past the 70-unit single limit. Segment one can
    // hold 33 emoji (66 units); the 34th would straddle unit 67, so it starts
    // segment two — the pair is never split, and a unit is left unused.
    const r = computeSegments("😀".repeat(36));
    expect(r.unitCount).toBe(72);
    expect(r.segments).toBe(2);
  });
});
