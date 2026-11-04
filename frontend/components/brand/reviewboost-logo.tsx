import { LogoMark } from "@/components/brand/logo-mark";
import { Wordmark } from "@/components/brand/wordmark";
import { cn } from "@/lib/utils/cn";

/**
 * One logo slot for the owner product.
 *
 * Poses and sizes follow the 2026-09-09 pack (full / mark / poweredBy;
 * nav / footer / poweredBy). The mark is `logo-mark.tsx`, drawn from
 * `Branding/Mark.svg`, and nowhere else. Do not invent a second mark.
 *
 * This is the horizontal lockup, `[mark] ReviewBoost`, the same one
 * `Branding/Logo.svg` exports: the mark beside the outlined wordmark, both
 * drawn from generated geometry, never retyped.
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

/** The type size the wordmark stands in for; the logotype box is 0.74 of it. */
const WORD_PX: Record<LogoSize, number> = {
  nav: 17,
  footer: 15,
  poweredBy: 13,
};

export function ReviewBoostLogo({
  pose = "full",
  size = "nav",
  poweredByLabel = "Powered by",
  className,
}: {
  pose?: LogoPose;
  size?: LogoSize;
  /** The credit line, for a customer page shown in another language. */
  poweredByLabel?: string;
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
        <span className="text-[length:var(--rb-text-caption)] text-muted">{poweredByLabel}</span>
      ) : null}

      <LogoMark size={mark} />

      {pose === "mark" ? (
        <span className="sr-only">ReviewBoost</span>
      ) : (
        /* The logotype, as Branding/Logo.svg sets it: "Review" in the
           surface's ink, "Boost" in the one brand green. Drawn from the
           outlined wordmark (see wordmark.tsx), with one readable name for
           assistive tech. */
        <>
          <span className="sr-only">ReviewBoost</span>
          <Wordmark height={WORD_PX[size] * 0.74} />
        </>
      )}
    </span>
  );
}
