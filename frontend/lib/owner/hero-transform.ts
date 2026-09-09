/**
 * Hero crop for the customer page.
 *
 * The rating card never moves. Only this transform is applied to the photo.
 * Values are clamped so a pinch cannot throw the artwork off the frame.
 */

export interface HeroTransform {
  x: number;
  y: number;
  scale: number;
}

export const DEFAULT_HERO_TRANSFORM: HeroTransform = { x: 0, y: 0, scale: 1 };

const MIN_SCALE = 1;
const MAX_SCALE = 3;
const MAX_SHIFT = 50;

export function clampHeroTransform(input: Partial<HeroTransform> | null | undefined): HeroTransform {
  const x = Number(input?.x);
  const y = Number(input?.y);
  const scale = Number(input?.scale);
  return {
    x: clampNumber(Number.isFinite(x) ? x : 0, -MAX_SHIFT, MAX_SHIFT),
    y: clampNumber(Number.isFinite(y) ? y : 0, -MAX_SHIFT, MAX_SHIFT),
    scale: clampNumber(Number.isFinite(scale) ? scale : 1, MIN_SCALE, MAX_SCALE),
  };
}

export function heroTransformStyle(transform: HeroTransform): string {
  const t = clampHeroTransform(transform);
  return `translate(${t.x}%, ${t.y}%) scale(${t.scale})`;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
