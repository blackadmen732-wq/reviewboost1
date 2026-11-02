import { BackLink } from "@/components/ui/back-link";
import { Skeleton } from "@/components/ui/skeleton";
import { OwnerShell } from "@/features/dashboard/owner-shell";

/** Connections while the directory loads: the real title, then three app cards. */
export default function ConnectionsLoading() {
  return (
    <OwnerShell wide>
      <BackLink href="/settings">Settings</BackLink>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Connections</h1>
        <p className="mt-1 text-base text-muted">
          Bring in customers from the apps you already use. Connecting an app never texts anyone.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-busy="true" aria-label="Loading your apps">
        {[0, 1, 2, 3, 4, 5].map((card) => (
          <div key={card} className="flex flex-col rounded-[var(--radius-card)] border border-border bg-surface">
            <div className="flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="mt-2 h-4 w-24" />
                </div>
                <Skeleton className="size-10 shrink-0 rounded-[10px]" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
            <div className="flex items-center justify-between border-t border-border px-5 py-4">
              <Skeleton className="h-11 w-24 rounded-[var(--radius-control)]" />
              <Skeleton className="h-7 w-20 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </OwnerShell>
  );
}
