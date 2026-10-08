import { Star } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * A rating, shown identically wherever it appears.
 *
 * WHY THIS IS ONE COMPONENT
 * -------------------------
 * The review-integrity rule says every rating is treated the same. That has to
 * hold in the interface too, and the reliable way to guarantee it is to have one
 * renderer with no branch on the value — no red 1s, no celebratory 5s, no
 * emphasis that quietly teaches an owner to read low ratings as failures of the
 * customer rather than information.
 *
 * Every star uses the same gold — a light, warm body with a darker gold edge
 * that keeps the shape at 3:1 — and only the count differs.
 *
 * The empty stars are drawn rather than omitted so that "3" and "3 out of 5"
 * cannot be confused at a glance — as soft solid shapes, so the filled ones
 * carry the row and a column of ratings does not read as a wall of outlines — and the whole group carries one label instead
 * of five, so a screen reader says "4 out of 5" and moves on.
 */

const SIZES = {
  sm: "size-4",
  md: "size-5",
  lg: "size-6",
} as const;

export function Stars({
  rating,
  size = "sm",
  className,
  animated = false,
  delay = 0,
}: {
  rating: number;
  size?: keyof typeof SIZES;
  className?: string;
  /** The stars fill one by one as they arrive. The same for every rating. */
  animated?: boolean;
  /** When the first star starts, in ms, so the stars can follow a card in. */
  delay?: number;
}) {
  return (
    <span
      className={cn("flex items-center gap-0.5", animated && "rb-stars-pop", className)}
      style={animated && delay ? ({ "--rb-stars-delay": `${delay}ms` } as React.CSSProperties) : undefined}
      role="img"
      aria-label={`${rating} out of 5`}
    >
      {[1, 2, 3, 4, 5].map((position) => (
        <Star
          key={position}
          // A finer edge than the icon default, so the gold body leads.
          strokeWidth={1.6}
          className={cn(
            SIZES[size],
            position <= rating
              ? "fill-[color:var(--rb-star-fill)] text-[color:var(--rb-star)]"
              : "fill-[color:var(--rb-border)] text-[color:var(--rb-border)]",
          )}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}
