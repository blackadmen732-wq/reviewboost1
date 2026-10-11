import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { AppShell } from "@/features/dashboard/app-shell";

/**
 * Text Requests while the balance, Tags and recent sends are in flight.
 *
 * The credit balance is deliberately a placeholder and not a zero: a "0"
 * that becomes "150" a moment later tells an owner they have run out when
 * they have not.
 */
export default function TextRequestsLoading() {
  return (
    <AppShell>
      <PageHeader
        title="Text Requests"
        description="Send a customer the link to your Tag. One message, one review request."
        tight
      />

      <div aria-busy="true" aria-label="Loading text requests">
        <Card>
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-2 h-7 w-36" />

          <Skeleton className="mt-6 h-4 w-20" />
          <Skeleton className="mt-2 h-14 w-full rounded-[var(--radius-control)]" />

          <Skeleton className="mt-5 h-4 w-28" />
          <Skeleton className="mt-2 h-14 w-full rounded-[var(--radius-control)]" />

          <Skeleton className="mt-6 h-14 w-full rounded-[var(--radius-control)]" />
        </Card>

        <Skeleton className="mb-3 mt-10 h-4 w-24" />
        <div className="divide-y divide-border border-y border-border">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex min-h-14 items-center justify-between gap-4 py-3.5">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
