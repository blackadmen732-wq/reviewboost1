import { BackLink } from "@/components/ui/back-link";
import { Skeleton } from "@/components/ui/skeleton";
import { OwnerShell } from "@/features/dashboard/owner-shell";

/**
 * One app's page while its details load. This page waits on several reads
 * (the app, its connection, your places and lists), so without this the tap
 * from the directory showed nothing until all of them finished.
 */
export default function ConnectionLoading() {
  return (
    <OwnerShell>
      <BackLink href="/settings/connections">Connections</BackLink>
      <div role="status" aria-busy="true" aria-label="Loading this app">
        <div className="mb-6 flex items-center gap-4">
          <Skeleton className="size-12 shrink-0 rounded-[var(--radius-control)]" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="mt-2 h-4 w-64 max-w-full" />
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="mt-2 h-12 w-full rounded-[var(--radius-control)]" />
        </div>
      </div>
    </OwnerShell>
  );
}
