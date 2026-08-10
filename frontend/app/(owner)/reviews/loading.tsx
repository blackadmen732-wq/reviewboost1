import { Skeleton } from "@/components/ui/skeleton";
import { AppShell } from "@/features/dashboard/app-shell";

/**
 * Reviews while its data is in flight.
 *
 * The shape matches the real page — same summary card height, same five
 * breakdown rows, same list rows. A skeleton that does not match causes a
 * visible jump when content lands, which reads as a bug even though nothing
 * failed.
 */
export default function ReviewsLoading() {
  return (
    <AppShell>
      <Skeleton className="mb-2 h-8 w-40" />
      <Skeleton className="mb-6 h-5 w-56" />

      <section className="mb-6 rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="mb-5 flex items-center gap-4">
          <Skeleton className="h-12 w-24" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <Skeleton className="h-4 w-10 shrink-0" />
              <Skeleton className="h-2.5 flex-1 rounded-full" />
              <Skeleton className="h-4 w-8 shrink-0" />
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            className="rounded-[var(--radius-card)] border border-border bg-surface p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="mt-3 h-5 w-3/4" />
          </div>
        ))}
      </div>
    </AppShell>
  );
}
