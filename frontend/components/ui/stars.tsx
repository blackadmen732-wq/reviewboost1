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
 * Every star uses the same gold. Only the count differs.
 *
 * The empty stars are drawn rather than omitted so that "3" and "3 out of 5"
 * cannot be confused at a glance, and the whole group carries one label instead
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
}: {
  rating: number;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      className={cn("flex items-center gap-0.5", className)}
      role="img"
      aria-label={`${rating} out of 5`}
    >
      {[1, 2, 3, 4, 5].map((position) => (
        <Star
          key={position}
          className={cn(
            SIZES[size],
            position <= rating
              ? "fill-[color:var(--rb-star)] text-[color:var(--rb-star)]"
              : "text-[color:var(--rb-border-strong)]",
          )}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}
