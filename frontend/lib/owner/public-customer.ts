/**
 * Customer-facing payload hygiene.
 * Even if an API grows ids, the guest page must never render them.
 */

const ID_KEY = /^(org|organization|location|stand|tag|tenant)Id$/i;
const UUID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

export interface CustomerPresentation {
  heroUrl: string | null;
  transform: { x: number; y: number; scale: number };
  tagline: string | null;
}

export const EMPTY_PRESENTATION: CustomerPresentation = {
  heroUrl: null,
  transform: { x: 0, y: 0, scale: 1 },
  tagline: null,
};

export function presentationFromUnknown(value: unknown, heroUrl: string | null): CustomerPresentation {
  if (!value || typeof value !== "object") {
    return { ...EMPTY_PRESENTATION, heroUrl };
  }
  const row = value as Record<string, unknown>;
  const tagline = typeof row.tagline === "string" ? row.tagline.trim().slice(0, 80) : "";
  return {
    heroUrl,
    transform: {
      x: Number(row.offsetX ?? row.offset_x ?? 0) || 0,
      y: Number(row.offsetY ?? row.offset_y ?? 0) || 0,
      scale: Number(row.scale ?? 1) || 1,
    },
    tagline: tagline.length > 0 ? tagline : null,
  };
}

export function payloadContainsTenantIds(value: unknown): boolean {
  return walk(value);
}

function walk(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return UUID.test(value);
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(walk);
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    if (ID_KEY.test(key)) return true;
    return walk(child);
  });
}
