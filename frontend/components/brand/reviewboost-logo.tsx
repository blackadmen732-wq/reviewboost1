import { LogoMark } from "@/components/brand/logo-mark";
import { cn } from "@/lib/utils/cn";

/**
 * One logo slot for the owner product.
 *
 * Poses and sizes follow the 2026-09-09 pack (full / mark / poweredBy;
 * nav / footer / poweredBy). The mark is `logo-mark.tsx`, drawn from
 * `Branding/Mark.svg`, and nowhere else. Do not invent a second mark.
 *
 * This is the horizontal lockup, `[mark] ReviewBoost`, that `Branding/Logo.svg`
 * exports for use outside the product. Here the name is live text in the
 * product's own face (Geist SemiBold, the face that file was outlined from):
 * it stays crisp at any size, follows the theme's ink, and is selectable.
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
        /* Two-tone, as Branding/Logo.svg sets it: "Review" in ink, "Boost"
           in the one ReviewBoost green. `aria-hidden` on the halves with a
           single readable label keeps a screen reader from announcing it as
           two words.

           Same weight, same size, no space: one word in two colours, kerned
           by the font. The green is the brand green (#00A86B), not the darker
           action green, because a logotype is exempt from WCAG text contrast
           (1.4.3, "Logotypes") and a second logo green is how the brand
           drifted before. Running text around it keeps the action green. */
        <span className={cn("font-semibold", WORD[size])}>
          <span className="sr-only">ReviewBoost</span>
          <span aria-hidden="true">Review</span>
          <span aria-hidden="true" className="text-[color:var(--rb-brand)]">
            Boost
          </span>
        </span>
      )}
    </span>
  );
}
