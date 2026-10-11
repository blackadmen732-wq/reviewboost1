import { Card } from "@/components/ui/card";
import { OwnerShell } from "@/features/dashboard/owner-shell";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Home while its data is in flight. Same vertical rhythm as the real page.
 *
 * The pulse card is the tall thing on this screen, so it is the one that has
 * to be here: a skeleton that leaves it out lets the feedback rows paint,
 * then shoves them down the page when the card arrives.
 */
export default function HomeLoading() {
  return (
    <OwnerShell>
      <header className="mb-8">
        <Skeleton className="h-8 w-48" />
      </header>

      <div className="flex flex-col gap-10">
        <div className="max-w-[36rem]">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="mt-3 h-9 w-64" />
          <Skeleton className="mt-3 h-5 w-72" />
          <Skeleton className="mt-6 h-14 w-full max-w-sm rounded-[var(--radius-control)]" />
        </div>

        {/* The 30-day pulse: header, three numbers, the band, the split. */}
        <Card as="section" aria-busy="true" aria-label="Loading the last 30 days">
          <div className="mb-5 flex items-baseline justify-between gap-4">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-5 w-24" />
          </div>
          <div className="grid grid-cols-3 gap-x-4">
            {[0, 1, 2].map((n) => (
              <div key={n}>
                <Skeleton className="h-8 w-16" />
                <Skeleton className="mt-2.5 h-4 w-24" />
              </div>
            ))}
          </div>
          <Skeleton className="mt-5 h-4 w-40" />
          <Skeleton className="mt-1.5 h-[96px] w-full" />
          <Skeleton className="mt-6 h-5 w-full rounded-full" />
          <div className="mt-3 flex gap-5">
            {[0, 1, 2].map((n) => (
              <Skeleton key={n} className="h-4 w-24" />
            ))}
          </div>
        </Card>

        <section>
          <Skeleton className="mb-2 h-4 w-32" />
          <div className="divide-y divide-border border-y border-border">
            {[0, 1].map((row) => (
              <div key={row} className="flex min-h-14 flex-col justify-center gap-2 py-3.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-full max-w-[26rem]" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </OwnerShell>
  );
}
