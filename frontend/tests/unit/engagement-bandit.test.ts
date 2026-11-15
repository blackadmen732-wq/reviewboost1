import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { chooseVariant, observedRate } from "@/lib/server/engagement/bandit";

function seeded(seed: number) {
  let n = seed;
  return () => {
    n += 0x6d2b79f5;
    let t = n;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
describe("adaptive message selection", () => {
  it("explores both templates without pretending a new program has learned outcomes", () => {
    const rng = seeded(12);
    let a = 0;
    for (let i = 0; i < 2000; i++) {
      const c = chooseVariant(
        [
          { id: "a", wins: 0, losses: 0 },
          { id: "b", wins: 0, losses: 0 },
        ],
        rng,
      );
      expect(c.source).toBe("cold_start");
      if (c.variant === "a") a++;
    }
    expect(a).toBeGreaterThan(850);
    expect(a).toBeLessThan(1150);
  });
  it("changes its preference when observed results change and keeps exploring", () => {
    for (const preferred of ["a", "b"]) {
      const rng = seeded(23);
      let winners = 0;
      let other = 0;
      const arms = ["a", "b"].map((id) => ({
        id,
        wins: id === preferred ? 100 : 10,
        losses: id === preferred ? 10 : 100,
      }));
      for (let i = 0; i < 2000; i++) {
        if (chooseVariant(arms, rng).variant === preferred) winners++;
        else other++;
      }
      expect(winners).toBeGreaterThan(1750);
      expect(other).toBeGreaterThan(30);
    }
  });
  it("rejects corrupt statistics and duplicate templates", () => {
    expect(() =>
      chooseVariant([
        { id: "a", wins: -1, losses: 1 },
        { id: "b", wins: 1, losses: 1 },
      ]),
    ).toThrow();
    expect(() =>
      chooseVariant([
        { id: "a", wins: 1, losses: 1 },
        { id: "a", wins: 1, losses: 1 },
      ]),
    ).toThrow();
  });
  it("retains the evidence behind a choice without mutating input", () => {
    const arms = [
      { id: "a", wins: 2, losses: 3 },
      { id: "b", wins: 4, losses: 2 },
    ];
    const c = chooseVariant(arms, seeded(1));
    expect(c.snapshot.outcomes).toBe(11);
    expect(c.snapshot.arms).toEqual(arms);
    expect(c.snapshot.arms).not.toBe(arms);
  });
  it("reports missing outcomes as unknown rates", () => {
    expect(observedRate(0, 0)).toEqual({
      rate: null,
      lower: null,
      upper: null,
    });
    expect(observedRate(25, 100)).toMatchObject({
      rate: 0.25,
      lower: expect.any(Number),
      upper: expect.any(Number),
    });
    expect(observedRate(25, 100).lower).toBeLessThan(0.25);
    expect(observedRate(25, 100).upper).toBeGreaterThan(0.25);
    expect(() => observedRate(2, 1)).toThrow();
  });
});
