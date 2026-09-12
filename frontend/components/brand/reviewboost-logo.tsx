import { LogoMark } from "@/components/brand/logo-mark";
import { cn } from "@/lib/utils/cn";

/**
 * One logo slot for the owner product.
 *
 * Poses and sizes follow the 2026-09-09 pack (full / mark / poweredBy;
 * nav / footer / poweredBy). Uses the real ReviewBoost speech-bubble mark
 * from /Branding.
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
        <span className={cn("font-semibold", WORD[size])}>ReviewBoost</span>
      )}
    </span>
  );
}
