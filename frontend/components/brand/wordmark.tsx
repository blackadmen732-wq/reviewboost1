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

/**
 * The monogram, for square spaces.
 *
 * A full wordmark does not survive an app icon. At 60 x 60 physical pixels
 * "ReviewBoost" is roughly 4pt type — an unreadable smudge, and every icon
 * guideline says so. So the square lockup is a "B": the letter carrying the
 * weight and the colour in the wordmark, which keeps the two recognisably
 * related rather than being a different mark entirely.
 *
 * Used for the favicon, the app icon, and anywhere the brand needs to sit in a
 * square.
 */
export function Monogram({ className }: { className?: string | undefined }) {
  return (
    <span
      className={cn(
        "grid aspect-square place-items-center rounded-[22%] bg-brand font-bold text-on-brand",
        className,
      )}
    >
      <span aria-hidden="true" className="translate-y-[-0.02em] tracking-[-0.04em]">
        B
      </span>
      <span className="sr-only">ReviewBoost</span>
    </span>
  );
}
