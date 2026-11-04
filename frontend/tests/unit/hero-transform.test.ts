import { describe, expect, it } from "vitest";

import {
  clampHeroTransform,
  DEFAULT_HERO_TRANSFORM,
  heroTransformStyle,
} from "@/lib/owner/hero-transform";

/**
 * The crop may never show what is behind the artwork.
 *
 * The clamp used a flat ±50% regardless of scale, so at scale 1 — where the
 * image exactly covers the frame and has no overhang to spend — the artwork
 * could still be slid half a frame sideways, putting a band of empty background
 * on the page a customer sees.
 */
describe("hero crop bounds", () => {
  it("allows no translation at scale 1", () => {
    for (const attempt of [50, -50, 12, -3, 999]) {
      expect(clampHeroTransform({ x: attempt, y: attempt, scale: 1 })).toEqual({
        x: 0,
        y: 0,
        scale: 1,
      });
    }
  });

  it("allows exactly the overhang the scale creates", () => {
    // At scale s the image overhangs by (s - 1) / 2 on each side.
    expect(clampHeroTransform({ x: 100, y: -100, scale: 2 })).toEqual({ x: 50, y: -50, scale: 2 });
    expect(clampHeroTransform({ x: 100, y: -100, scale: 1.5 })).toEqual({
      x: 25,
      y: -25,
      scale: 1.5,
    });
  });

  it("keeps a translation that is within the overhang", () => {
    expect(clampHeroTransform({ x: 10, y: -8, scale: 2 })).toEqual({ x: 10, y: -8, scale: 2 });
  });

  it("clamps the scale before deciding how far the artwork may travel", () => {
    // A scale of 9 is clamped to 3, so the travel is 3's, not 9's.
    expect(clampHeroTransform({ x: 500, y: 0, scale: 9 })).toEqual({ x: 100, y: 0, scale: 3 });
    // Below 1 is clamped up to 1, which then permits no travel at all.
    expect(clampHeroTransform({ x: 40, y: 40, scale: 0.2 })).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it("falls back to the default rather than NaN", () => {
    expect(clampHeroTransform(null)).toEqual(DEFAULT_HERO_TRANSFORM);
    expect(clampHeroTransform(undefined)).toEqual(DEFAULT_HERO_TRANSFORM);
    expect(clampHeroTransform({ x: NaN, y: NaN, scale: NaN })).toEqual(DEFAULT_HERO_TRANSFORM);
    expect(clampHeroTransform({})).toEqual(DEFAULT_HERO_TRANSFORM);
  });

  it("is the identity transform by default, so preview and /q agree", () => {
    expect(DEFAULT_HERO_TRANSFORM).toEqual({ x: 0, y: 0, scale: 1 });
    expect(heroTransformStyle(DEFAULT_HERO_TRANSFORM)).toBe("translate(0%, 0%) scale(1)");
  });

  it("clamps inside the style helper too, so no caller can route around it", () => {
    expect(heroTransformStyle({ x: 80, y: 80, scale: 1 })).toBe("translate(0%, 0%) scale(1)");
  });
});
