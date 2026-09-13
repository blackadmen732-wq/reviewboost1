export interface HeroTransform {
  x: number;
  y: number;
  scale: number;
}

export const DEFAULT_HERO_TRANSFORM: HeroTransform = { x: 0, y: 0, scale: 1 };

const MIN_SCALE = 1;
const MAX_SCALE = 3;

function maxShift(scale: number): number {
  return Math.max(0, ((scale - 1) / scale) * 50);
}

export function clampHeroTransform(input: Partial<HeroTransform> | null | undefined): HeroTransform {
  const x = Number(input?.x);
  const y = Number(input?.y);
  const scale = Number(input?.scale);
  const s = clampNumber(Number.isFinite(scale) ? scale : 1, MIN_SCALE, MAX_SCALE);
  const limit = maxShift(s);
  return {
    x: clampNumber(Number.isFinite(x) ? x : 0, -limit, limit),
    y: clampNumber(Number.isFinite(y) ? y : 0, -limit, limit),
    scale: s,
  };
}

export function heroTransformStyle(transform: HeroTransform): string {
  const t = clampHeroTransform(transform);
  return `translate(${t.x}%, ${t.y}%) scale(${t.scale})`;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value)) || 0;
}
