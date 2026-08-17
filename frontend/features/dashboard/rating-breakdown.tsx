import { Star } from "lucide-react";

/**
 * How many people gave each number of stars.
 *
 * NEUTRALITY IS THE DESIGN CONSTRAINT
 * -----------------------------------
 * Every bar is the same colour. The obvious version of this chart runs green at
 * the top to red at the bottom, and that single decision would quietly turn the
 * screen into a scoreboard — teaching an owner to read a 2-star bar as a failure
 * to be suppressed rather than as a customer telling them something.
 *
 * That framing is what leads businesses to want rating-dependent behaviour in
 * the first place. This product does not offer that, so its charts should not
 * imply it.
 *
 * Bars are scaled against the largest row, not the total. Against the total, a
 * business with 90% fives shows four invisible slivers, and the four ratings the
 * owner most needs to see become the four they cannot.
 */
export function RatingBreakdown({
  counts,
  total,
}: {
  counts: Record<1 | 2 | 3 | 4 | 5, number>;
  total: number;
}) {
  const rows = ([5, 4, 3, 2, 1] as const).map((rating) => ({ rating, count: counts[rating] }));
  const peak = Math.max(...rows.map((row) => row.count), 1);

  return (
    <div className="flex flex-col gap-2">
      {rows.map(({ rating, count }) => {
        const share = total > 0 ? Math.round((count / total) * 100) : 0;

        return (
          <div key={rating} className="flex items-center gap-3">
            <span className="flex w-10 shrink-0 items-center gap-1 text-sm font-medium tabular-nums text-muted">
              {rating}
              <Star
                className="size-3.5 fill-[color:var(--rb-star)] text-[color:var(--rb-star)]"
                aria-hidden="true"
              />
            </span>

            <div
              className="h-2.5 flex-1 overflow-hidden rounded-full bg-quiet"
              role="img"
              aria-label={`${rating} stars: ${count} ${count === 1 ? "rating" : "ratings"}, ${share} percent`}
            >
              <div
                className="h-full rounded-full bg-[color:var(--rb-star)] transition-[width] duration-500 motion-reduce:transition-none"
                style={{ width: `${(count / peak) * 100}%` }}
              />
            </div>

            <span className="w-8 shrink-0 text-right text-sm tabular-nums text-muted">{count}</span>
          </div>
        );
      })}
    </div>
  );
}
