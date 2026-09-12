import { isLocale, supportedLocales, type Locale } from "@/lib/i18n/config";

/**
 * What a business is allowed to change about its customer page.
 *
 * Everything here belongs to the business: the photograph, the mark, the
 * wording of the tagline, and which of the curated Looks composes them. Nothing
 * here can move the rating sheet, restyle the stars, or add a step — the page
 * architecture is ReviewBoost's, and a customer who has used one of these pages
 * has used all of them.
 *
 * The backend does not send these fields yet. They are defined here in the
 * shape the API will use so the page can be wired to real data without any
 * component changing, and every reader goes through
 * `normalizeCustomerPageDesign`, which treats the payload as untrusted.
 */

export const lookIds = [
  "signature",
  "modern",
  "bold",
  "editorial",
  "classic",
  "minimal",
] as const;

export type LookId = (typeof lookIds)[number];

export const defaultLookId: LookId = "signature";

export function isLookId(value: unknown): value is LookId {
  return lookIds.includes(value as LookId);
}

export interface CustomerPageDesign {
  heroImage: string | null;
  /** Horizontal focal point of the hero photograph, 0–100. */
  heroFocalX: number;
  /** Vertical focal point of the hero photograph, 0–100. */
  heroFocalY: number;
  /** 1 is "cover, untouched". Above that the owner has cropped in. */
  heroZoom: number;
  logo: string | null;
  look: LookId;
  tagline: string | null;
}

export const emptyCustomerPageDesign: CustomerPageDesign = {
  heroImage: null,
  heroFocalX: 50,
  heroFocalY: 50,
  heroZoom: 1,
  logo: null,
  look: defaultLookId,
  tagline: null,
};

/** Everything the customer page needs to render, from any source. */
export interface CustomerPagePresentation {
  businessName: string;
  locationName: string | null;
  design: CustomerPageDesign;
  languages: readonly Locale[];
  defaultLanguage: Locale;
}

export const minHeroZoom = 1;
export const maxHeroZoom = 3;
export const maxTaglineLength = 64;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Images are rendered into an `<img src>`, so a hostile value cannot execute
 * script — but it can still point at an attacker's host or smuggle in a
 * `javascript:` URL that some embedded webview treats generously. Only the three
 * forms this product actually produces are allowed through: an absolute HTTPS
 * URL, a same-origin path, or an inline image the owner just picked.
 */
export function safeImageSource(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  if (/^data:image\/(png|jpeg|jpg|webp|gif|avif);base64,[a-z0-9+/=]+$/i.test(trimmed)) {
    return trimmed;
  }
  try {
    return new URL(trimmed).protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

function safeTagline(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/gu, " ").trim().slice(0, maxTaglineLength);
  return collapsed || null;
}

export function normalizeCustomerPageDesign(input: unknown): CustomerPageDesign {
  const source = (input ?? {}) as Partial<Record<keyof CustomerPageDesign, unknown>>;
  return {
    heroImage: safeImageSource(source.heroImage),
    heroFocalX: clamp(Math.round(numberOr(source.heroFocalX, 50)), 0, 100),
    heroFocalY: clamp(Math.round(numberOr(source.heroFocalY, 50)), 0, 100),
    heroZoom:
      Math.round(clamp(numberOr(source.heroZoom, 1), minHeroZoom, maxHeroZoom) * 100) /
      100,
    logo: safeImageSource(source.logo),
    look: isLookId(source.look) ? source.look : defaultLookId,
    tagline: safeTagline(source.tagline),
  };
}

export function designsAreEqual(
  left: CustomerPageDesign,
  right: CustomerPageDesign,
): boolean {
  return (
    left.heroImage === right.heroImage &&
    left.heroFocalX === right.heroFocalX &&
    left.heroFocalY === right.heroFocalY &&
    left.heroZoom === right.heroZoom &&
    left.logo === right.logo &&
    left.look === right.look &&
    left.tagline === right.tagline
  );
}

export function normalizeLanguages(value: unknown): Locale[] {
  const list = Array.isArray(value) ? value.filter(isLocale) : [];
  const unique = [...new Set(list)];
  const ordered = supportedLocales.filter((locale) => unique.includes(locale));
  return ordered.length ? ordered : ["en"];
}

export function resolveDefaultLanguage(
  candidate: unknown,
  languages: readonly Locale[],
): Locale {
  if (isLocale(candidate) && languages.includes(candidate)) return candidate;
  return languages[0] ?? "en";
}
