import { cn } from "@/lib/utils/cn";

/**
 * The ReviewBoost wordmark.
 *
 * Text only, no icon — the same decision Uber Eats and DoorDash made, and for
 * the same reason: a wordmark is legible at any size, needs no explanation, and
 * cannot be mistaken for a competitor's abstract shape.
 *
 * The weight break is where the brand lives. "Review" is what the customer
 * does; "Boost" is what the business gets, so "Boost" carries the weight and
 * the colour. Two weights of one typeface reads as considered; two typefaces
 * reads as a template.
 *
 * Optical detail worth keeping: the tracking tightens as the size grows.
 * Letterforms need more air when small and look loose when large, so a single
 * tracking value is wrong at one end or the other.
 */

type Size = "sm" | "md" | "lg" | "xl";
type Tone = "default" | "mono" | "inverse";

const SIZES: Record<Size, string> = {
  sm: "text-base tracking-[-0.01em]",
  md: "text-lg tracking-[-0.015em]",
  lg: "text-2xl tracking-[-0.025em]",
  xl: "text-[2.5rem] leading-none tracking-[-0.035em]",
};

const TONES: Record<Tone, { review: string; boost: string }> = {
  // Green on "Boost" only. Colouring the whole wordmark makes it shout; the
  // break is what makes it read as a brand rather than a heading.
  default: { review: "text-ink", boost: "text-brand-text" },
  // For places where colour would compete — inside a coloured card, or on a
  // customer's screen where the *business* should be the loudest thing.
  mono: { review: "text-ink", boost: "text-ink" },
  inverse: { review: "text-white", boost: "text-white" },
};

export function Wordmark({
  size = "md",
  tone = "default",
  className,
}: {
  size?: Size;
  tone?: Tone;
  className?: string | undefined;
}) {
  const colours = TONES[tone];

  return (
    // One accessible name for screen readers and search, so the weight split
    // never turns into "Review Boost" read as two words.
    <span className={cn("inline-flex select-none items-baseline", SIZES[size], className)}>
      <span aria-hidden="true" className={cn("font-normal", colours.review)}>
        Review
      </span>
      <span aria-hidden="true" className={cn("font-bold", colours.boost)}>
        Boost
      </span>
      <span className="sr-only">ReviewBoost</span>
    </span>
  );
}
