import { Skeleton } from "@/components/ui/skeleton";
import { AppShell } from "@/features/dashboard/app-shell";

/**
 * Customers while its data is in flight.
 *
 * Matches the real page: four metric tiles above a list of visit rows.
 */
export default function CustomersLoading() {
  return (
    <AppShell>
      <Skeleton className="mb-2 h-8 w-44" />
      <Skeleton className="mb-6 h-5 w-52" />

      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((tile) => (
          <div
            key={tile}
            className="rounded-[var(--radius-card)] border border-border bg-surface p-4"
          >
            <Skeleton className="mb-2 size-5 rounded-full" />
            <Skeleton className="h-7 w-12" />
            <Skeleton className="mt-2 h-4 w-16" />
          </div>
        ))}
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
            <Skeleton className="mt-3 h-6 w-40 rounded-full" />
          </div>
        ))}
      </div>
    </AppShell>
  );
}
