import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { AppShell } from "@/features/dashboard/app-shell";

/**
 * Settings while the business, its places and the plan are in flight.
 *
 * Grouped exactly as the real page is — a quiet caption, then a card of rows
 * — because the group captions are the landmarks somebody scans for, and a
 * flat stack of bars that then re-groups is a worse wait than a longer one.
 */
function GroupSkeleton({ rows, labelWidth }: { rows: number; labelWidth: string }) {
  return (
    <section className="mb-7">
      <Skeleton className={`mb-2 ml-1 h-4 ${labelWidth}`} />
      <div className="divide-y divide-[color:var(--rb-border-strong)] overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-[var(--shadow-card)]">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex min-h-14 items-center justify-between gap-4 px-4 py-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-24" />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function SettingsLoading() {
  return (
    <AppShell>
      <PageHeader title="Settings" />
      <div aria-busy="true" aria-label="Loading settings">
        <GroupSkeleton rows={1} labelWidth="w-20" />
        <GroupSkeleton rows={2} labelWidth="w-16" />
        <GroupSkeleton rows={3} labelWidth="w-24" />
      </div>
    </AppShell>
  );
}
