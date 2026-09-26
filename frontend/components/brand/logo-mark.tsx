"use client";

import { useId } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * THE mark graphic — the owner's approved ReviewBoost mark.
 *
 * Source of truth: `Branding/Logo.svg`, uploaded by the owner. A speech bubble
 * with an arrow tail: the conversation a customer has with the business, and
 * the lift that follows. Nothing here is drawn or approximated — the paths are
 * the supplied asset verbatim.
 *
 * This is the only place the mark exists. `ReviewBoostLogo` reads this slot and
 * every surface reads that, so the public site, the auth chrome, the owner
 * sidebar and "Powered by ReviewBoost" cannot drift apart. Do not paste these
 * paths into a second component.
 *
 * `size` is the HEIGHT, and the width follows the mark's own proportions. An
 * approved logo is never stretched to fit a box.
 *
 * The supplied artboard is 301×343, but the ink stops at y≈270.5 — the bottom
 * fifth is empty. Measured, not guessed: rendering the asset and trimming the
 * transparent margin gives 300.75×270.5 from the origin. The viewBox below is
 * that measured extent, so the mark optically centres against the wordmark
 * instead of floating high with a gap under it. Only empty artboard is cropped;
 * no path is touched.
 *
 * THE COUNTER IS A HOLE, NOT WHITE PAINT
 * The supplied file fills the inner pill and the rising stroke with white,
 * which only reads correctly on a white page. On every dark surface — the
 * dark theme, the sidebar, the public site — it showed as a white blob inside
 * the green. The approved artwork shows the page through that counter, so the
 * same two paths are used here as a mask that cuts them out of the bubble.
 * Same geometry, same order; they punch through instead of painting over.
 *
 * The mask id comes from `useId`, so two logos on one page (a sidebar hidden
 * at one breakpoint and a header shown at the other) never share a mask that
 * lives inside a `display: none` subtree.
 */

/** The mark's measured ink extent within the supplied 301×343 artboard. */
const INTRINSIC_WIDTH = 301;
const INTRINSIC_HEIGHT = 271;

export function LogoMark({
  size,
  className,
}: {
  size: number;
  className?: string | undefined;
}) {
  const maskId = `rb-mark-cut-${useId().replace(/:/g, "")}`;

  return (
    <svg
      width={(size * INTRINSIC_WIDTH) / INTRINSIC_HEIGHT}
      height={size}
      viewBox={`0 0 ${INTRINSIC_WIDTH} ${INTRINSIC_HEIGHT}`}
      fill="none"
      role="img"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      {/* Bubble body, with the counter cut out of it. The token carries the
          approved green as its fallback, so a themed surface can tint the mark
          without the hex living in two files. */}
      <path
        d="M0 50C0 22.3858 22.3858 0 50 0H217.113C244.727 0 267.113 22.3858 267.113 50V98.6307C267.113 126.119 244.801 148.297 217.899 153.938C201.98 157.276 179.974 160.644 111.34 159.463C98.8698 159.249 87.3741 166.636 82.649 178.179L55.5 244.5L48.3527 257.185C35.3044 280.343 0 271.081 0 244.5V88.7455V50Z"
        fill="var(--rb-brand, #00A86B)"
        mask={`url(#${maskId})`}
      />
      {/* Arrow tail. It never meets the counter, so it needs no mask. */}
      <path
        d="M121.5 168.494L202.002 168.932C207.976 168.965 213.759 171.379 217.873 175.558L301 260L211.014 259.51C207.921 259.493 204.935 258.199 202.872 255.981L121.5 168.494Z"
        fill="var(--rb-brand, #00A86B)"
      />
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width={INTRINSIC_WIDTH}
          height={INTRINSIC_HEIGHT}
        >
          <rect
            width={INTRINSIC_WIDTH}
            height={INTRINSIC_HEIGHT}
            fill="#FFFFFF"
          />
          {/* Inner pill: black in a mask is transparent on the page. */}
          <path
            d="M25 74.1048C25 45.8804 47.8804 23 76.1048 23H170.798C199.023 23 221.903 45.8804 221.903 74.1048V74.1048C221.903 102.329 199.023 125.21 170.798 125.21H76.1048C47.8804 125.21 25 102.329 25 74.1048V74.1048Z"
            fill="#000000"
          />
          {/* Rising stroke, at the supplied stroke width. */}
          <path
            d="M45.2828 162.438L46.9369 108.884C46.9369 108.884 118.5 59.5 95.045 108.729C71.5897 157.958 45.2828 162.438 45.2828 162.438Z"
            fill="#000000"
            stroke="#000000"
            strokeWidth="10"
          />
        </mask>
      </defs>
    </svg>
  );
}
