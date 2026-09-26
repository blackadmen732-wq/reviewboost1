import {
  WORDMARK_BOOST,
  WORDMARK_HEIGHT,
  WORDMARK_REVIEW,
  WORDMARK_VIEWBOX,
  WORDMARK_WIDTH,
} from "@/components/brand/mark-geometry";
import { cn } from "@/lib/utils/cn";

/**
 * "ReviewBoost" as the logotype: Geist SemiBold outlines from
 * `Branding/Wordmark.svg`, via the generated `mark-geometry.ts`.
 *
 * Drawn, not typed, so "Boost" carries the one brand green (#00A86B) the mark
 * does. As live text at 13–17px that green fails text contrast (2.9:1), which
 * is how the product ended up with a second, darker "logo" green. A logotype is
 * exempt (WCAG 1.4.3), and an image is what it is.
 *
 * "Review" takes `currentColor`, so it follows the surface's ink in light and
 * dark themes. The graphic is decorative; callers supply the readable name.
 *
 * `height` is the box height (cap height plus overshoot), which is 0.74 of
 * the font size the wordmark stands in for: pass `0.74em` to match text.
 */
export function Wordmark({
  height,
  className,
}: {
  height: number | string;
  className?: string | undefined;
}) {
  const h = typeof height === "number" ? `${height}px` : height;

  return (
    <svg
      viewBox={WORDMARK_VIEWBOX}
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
      style={{ height: h, width: `calc(${h} * ${WORDMARK_WIDTH} / ${WORDMARK_HEIGHT})` }}
    >
      <path d={WORDMARK_REVIEW} fill="currentColor" />
      <path d={WORDMARK_BOOST} fill="var(--rb-brand, #00A86B)" />
    </svg>
  );
}
