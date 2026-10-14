import { ChevronRight, Star } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils/cn";

/**
 * How many people gave each number of stars.
 *
 * NEUTRALITY IS THE DESIGN CONSTRAINT
 * -----------------------------------
 * Every bar is the same colour, and it is not a colour that means anything:
 * ink, at a tint. The obvious version of this chart runs green at the top to
 * red at the bottom, and that single decision would quietly turn the screen
 * into a scoreboard — teaching an owner to read a 2-star bar as a failure to
 * be suppressed rather than as a customer telling them something. Gold stays
 * on the star icons, where it means "stars" and nothing else.
 *
 * That framing is what leads businesses to want rating-dependent behaviour in
 * the first place. This product does not offer that, so its charts should not
 * imply it.
 *
 * Bars are scaled against the largest row, not the total. Against the total, a
 * business with 90% fives shows four invisible slivers, and the four ratings the
 * owner most needs to see become the four they cannot. For the same reason the
 * rows carry counts, never percentages.
 *
 * With `rowHref`, each row with ratings in it opens those ratings in the inbox.
 */
export function RatingBreakdown({
  counts,
  rowHref,
}: {
  counts: Record<1 | 2 | 3 | 4 | 5, number>;
  rowHref?: ((rating: 1 | 2 | 3 | 4 | 5) => string) | undefined;
}) {
  const rows = ([5, 4, 3, 2, 1] as const).map((rating) => ({ rating, count: counts[rating] }));
  const peak = Math.max(...rows.map((row) => row.count), 1);

  return (
    <ul className="flex flex-col">
      {rows.map(({ rating, count }) => {
        const label = `${rating} ${rating === 1 ? "star" : "stars"}: ${count} ${count === 1 ? "rating" : "ratings"}`;
        const href = rowHref && count > 0 ? rowHref(rating) : null;

        const body = (
          <>
            <span className="flex w-10 shrink-0 items-center gap-1 text-sm font-medium tabular-nums text-ink">
              {rating}
              <Star
                className="size-3.5 fill-[color:var(--rb-star)] text-[color:var(--rb-star)]"
                aria-hidden="true"
              />
            </span>

            <span className="h-2 flex-1 overflow-hidden rounded-full bg-quiet" aria-hidden="true">
              <span
                className="block h-full rounded-full bg-ink/70 transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${(count / peak) * 100}%` }}
              />
            </span>

            <span className="w-10 shrink-0 text-right text-sm tabular-nums text-muted" aria-hidden="true">
              {count}
            </span>

            <span className="flex w-5 shrink-0 justify-end" aria-hidden="true">
              {href ? (
                <ChevronRight className="size-4 text-muted transition-transform duration-150 group-hover:translate-x-0.5" />
              ) : null}
            </span>
          </>
        );

        return (
          <li key={rating}>
            {href ? (
              <Link
                href={href}
                aria-label={`${label}. Show them.`}
                className={cn(
                  "group -mx-2 flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-2",
                  "transition-colors duration-150 hover:bg-quiet active:bg-quiet",
                  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
                )}
              >
                {body}
              </Link>
            ) : (
              <div className="-mx-2 flex min-h-11 items-center gap-3 px-2" role="img" aria-label={label}>
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
