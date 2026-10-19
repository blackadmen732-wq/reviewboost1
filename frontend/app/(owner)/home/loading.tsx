import { OwnerShell } from "@/features/dashboard/owner-shell";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Home while its data is in flight.
 *
 * A wireframe of the real page (OwnerHome): business name, the "Needs you /
 * All good" line, the big status sentence, one line under it, and the one
 * button, at the same sizes and gaps, so nothing jumps when the data lands.
 */
export default function HomeLoading() {
  return (
    <OwnerShell>
      <div aria-busy="true" aria-label="Loading Home">
        <header className="mb-8">
          <Skeleton className="h-7 w-44" />
        </header>
        <section className="max-w-[36rem]">
          <Skeleton className="mb-3 h-5 w-24" />
          <Skeleton className="h-9 w-72 max-w-full" />
          <Skeleton className="mt-3 h-5 w-80 max-w-full" />
          <div className="mt-6 max-w-sm">
            <Skeleton className="h-14 w-full rounded-[var(--radius-control)]" />
          </div>
        </section>
      </div>
    </OwnerShell>
  );
}
