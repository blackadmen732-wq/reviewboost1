/**
 * Hero crop for the customer page.
 *
 * The rating card never moves. Only this transform is applied to the photo.
 * Values are clamped against the scale, so no crop can slide the artwork far
 * enough to show empty background behind it.
 */

export interface HeroTransform {
  x: number;
  y: number;
  scale: number;
}

export const DEFAULT_HERO_TRANSFORM: HeroTransform = { x: 0, y: 0, scale: 1 };

const MIN_SCALE = 1;
const MAX_SCALE = 3;

/**
 * How far the artwork may travel before its own edge enters the frame.
 *
 * The image is `object-fit: cover`, so at scale s it overhangs the frame by
 * (s - 1) / 2 on each side — in percent of its own width, (s - 1) / 2 * 100.
 * That is the entire travel available.
 *
 * A flat 50% cap ignored the scale, so at scale 1 — where there is no overhang
 * at all — the artwork could still be slid half a frame across and the business
 * would be showing its customers a band of empty background. At scale 1 the
 * only honest translation is none.
 */
function maxShiftPercent(scale: number): number {
  return ((scale - 1) / 2) * 100;
}

export function clampHeroTransform(input: Partial<HeroTransform> | null | undefined): HeroTransform {
  const x = Number(input?.x);
  const y = Number(input?.y);
  const scale = Number(input?.scale);

  // Scale is resolved first: it is what decides how far x and y may go.
  const safeScale = clampNumber(Number.isFinite(scale) ? scale : 1, MIN_SCALE, MAX_SCALE);
  const limit = maxShiftPercent(safeScale);

  return {
    x: clampNumber(Number.isFinite(x) ? x : 0, -limit, limit),
    y: clampNumber(Number.isFinite(y) ? y : 0, -limit, limit),
    scale: safeScale,
  };
}

export function heroTransformStyle(transform: HeroTransform): string {
  const t = clampHeroTransform(transform);
  return `translate(${t.x}%, ${t.y}%) scale(${t.scale})`;
}

function clampNumber(value: number, min: number, max: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  // `Math.max(-0, -50)` is -0, which serialises into CSS as "-0%". Harmless to
  // render, but it makes the value awkward to compare and to read in a test.
  return clamped === 0 ? 0 : clamped;
}
