/**
 * The owner's photo at phone size.
 *
 * Owners upload up to 5 MB, straight from their camera roll, and the customer
 * page used to load that original file: several seconds of a dark box on a
 * cellular connection, for a picture shown 430 pixels wide. Photos in the
 * public customer-page bucket now go through Next's image optimizer, which
 * resizes and re-encodes them (WebP) and caches the result; the browser picks
 * the width it needs from `srcSet`.
 *
 * Anything else — a draft `blob:` in the owner's editor, a local development
 * URL the optimizer refuses, an unexpected host — is used as it is.
 */

/** Widths the optimizer allows (next.config `deviceSizes`), up to a sharp 3x phone. */
const WIDTHS = [640, 828, 1080, 1200] as const;

/**
 * The hero fills the canvas with `object-fit: cover`, so a landscape photo is
 * drawn wider than the screen. 140vw covers a 4:3 photo on a tall phone canvas.
 */
const SIZES = "(max-width: 480px) 140vw, 640px";

export interface HeroImageSources {
  src: string;
  srcSet?: string;
  sizes?: string;
}

function optimizablePrefix(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null;
  try {
    const origin = new URL(supabaseUrl);
    // The optimizer refuses local addresses, so local stacks keep the original.
    if (origin.protocol !== "https:") return null;
    return `${origin.origin}/storage/v1/object/public/customer-page/`;
  } catch {
    return null;
  }
}

export function heroImageSources(
  src: string,
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): HeroImageSources {
  const prefix = optimizablePrefix(supabaseUrl);
  if (!prefix || !src.startsWith(prefix)) return { src };
  const at = (width: number) => `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=75`;
  return {
    src: at(828),
    srcSet: WIDTHS.map((width) => `${at(width)} ${width}w`).join(", "),
    sizes: SIZES,
  };
}

/** The `images.remotePatterns` entry that lets the optimizer read the bucket. */
export function heroImageRemotePattern(
  supabaseUrl: string | undefined,
): { protocol: "https"; hostname: string; pathname: string } | null {
  const prefix = optimizablePrefix(supabaseUrl);
  if (!prefix) return null;
  const url = new URL(prefix);
  return { protocol: "https", hostname: url.hostname, pathname: `${url.pathname}**` };
}
