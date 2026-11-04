import { MARK_HEIGHT, MARK_PATHS, MARK_WIDTH } from "@/components/brand/mark-geometry";
import { cn } from "@/lib/utils/cn";

/**
 * THE mark graphic: the ReviewBoost R, whose bowl is a speech bubble.
 *
 * Source of truth: `Branding/Mark.svg`. This component holds no geometry of
 * its own; it draws `mark-geometry.ts`, which
 * `scripts/brand/generate-brand-assets.mjs` writes from that file, alongside
 * every app icon, favicon and native raster. Change the mark there, run the
 * script, and every surface follows.
 *
 * `ReviewBoostLogo` reads this slot and every surface reads that, so the
 * public site, the auth chrome, the owner sidebar and "Powered by ReviewBoost"
 * cannot drift apart. Do not paste paths into a second component.
 *
 * `size` is the HEIGHT, and the width follows the mark's own proportions. The
 * viewBox is the ink's own box, so the mark centres against the wordmark with
 * no empty artboard under it.
 *
 * The counter is a hole in the path, not white paint, so the page shows
 * through it on light, dark and green surfaces alike.
 */
export function LogoMark({
  size,
  className,
}: {
  size: number;
  className?: string | undefined;
}) {
  return (
    <svg
      width={(size * MARK_WIDTH) / MARK_HEIGHT}
      height={size}
      viewBox={`0 0 ${MARK_WIDTH} ${MARK_HEIGHT}`}
      fill="none"
      role="img"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      {/* The token carries the brand green as its fallback, so a themed
          surface can tint the mark without the hex living in two files. */}
      {MARK_PATHS.map((d) => (
        <path key={d} d={d} fill="var(--rb-brand, #00A86B)" />
      ))}
    </svg>
  );
}
