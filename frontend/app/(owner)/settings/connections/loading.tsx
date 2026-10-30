import { BackLink } from "@/components/ui/back-link";
import { Skeleton } from "@/components/ui/skeleton";
import { OwnerShell } from "@/features/dashboard/owner-shell";

/** Connections while the directory loads: the real title, then three app cards. */
export default function ConnectionsLoading() {
  return (
    <OwnerShell>
      <BackLink href="/settings">Settings</BackLink>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Connections</h1>
        <p className="mt-1 text-base text-muted">
          Bring in customers from the apps you already use. Connecting an app never texts anyone.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2" role="status" aria-busy="true" aria-label="Loading your apps">
        {[0, 1, 2].map((card) => (
          <div key={card} className="flex gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <Skeleton className="size-10 shrink-0 rounded-[var(--radius-control)]" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="mt-2 h-4 w-full" />
            </div>
          </div>
        ))}
      </div>
    </OwnerShell>
  );
}
