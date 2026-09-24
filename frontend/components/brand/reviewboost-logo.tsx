import { LogoMark } from "@/components/brand/logo-mark";
import { cn } from "@/lib/utils/cn";

/**
 * One logo slot for the owner product.
 *
 * Poses and sizes follow the 2026-09-09 pack (full / mark / poweredBy;
 * nav / footer / poweredBy). The mark is the owner's approved asset, held in
 * `logo-mark.tsx` and nowhere else. Do not invent a second mark.
 *
 * The name beside it is live text in the product's own face rather than a
 * wordmark image: it stays crisp at any size, inherits the surrounding colour,
 * and is selectable and translatable. There is no wordmark asset to match —
 * the supplied artwork is the mark alone.
 *
 * Clearspace is 0.25 × mark size on every side (`--rb-logo-clearspace`).
 */

export type LogoPose = "full" | "mark" | "poweredBy";
export type LogoSize = "nav" | "footer" | "poweredBy";

const MARK_PX: Record<LogoSize, number> = {
  nav: 28,
  footer: 24,
  poweredBy: 16,
};

const WORD: Record<LogoSize, string> = {
  nav: "text-[1.0625rem] tracking-[-0.02em]",
  footer: "text-[0.9375rem] tracking-[-0.015em]",
  poweredBy: "text-[0.8125rem] tracking-[-0.01em]",
};

export function ReviewBoostLogo({
  pose = "full",
  size = "nav",
  className,
}: {
  pose?: LogoPose;
  size?: LogoSize;
  className?: string | undefined;
}) {
  const mark = MARK_PX[size];
  const pad = `calc(${mark}px * var(--rb-logo-clearspace))`;

  return (
    <span
      className={cn("inline-flex items-center text-ink", className)}
      style={{ padding: pad, gap: pad }}
      data-logo-pose={pose}
      data-logo-size={size}
    >
      {pose === "poweredBy" ? (
        <span className="text-[length:var(--rb-text-caption)] text-muted">Powered by</span>
      ) : null}

      <LogoMark size={mark} />

      {pose === "mark" ? (
        <span className="sr-only">ReviewBoost</span>
      ) : (
        /* Two-tone, as the approved lockup sets it: "Review" in ink, "Boost" in
           green. One <span> in a single colour was not the wordmark.
           `aria-hidden` on the halves with a single readable label keeps a
           screen reader from announcing it as two words.

           The green here is the brand TEXT green, not the raw brand green,
           and that is deliberate. A logotype rendered as an image is exempt
           from WCAG contrast; this is live text, which is not. Brand green on
           white measures below the 4.5:1 floor for normal text, and the
           "Powered by ReviewBoost" footer sets it at 13px. The text green
           clears AA on white and on the canvas. The mark itself keeps the
           brand green, because a graphic may. */
        <span className={cn("font-semibold", WORD[size])}>
          <span className="sr-only">ReviewBoost</span>
          <span aria-hidden="true">Review</span>
          <span aria-hidden="true" className="text-[color:var(--rb-brand-text)]">
            Boost
          </span>
        </span>
      )}
    </span>
  );
}
