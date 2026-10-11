import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { AppShell } from "@/features/dashboard/app-shell";

/**
 * Billing while the plan and usage are in flight.
 *
 * Nothing here guesses at a plan name, a price, a status or a renewal date.
 * This page's whole rule is that it never writes a value the backend has not
 * given it — a skeleton that filled any of them in, even for a moment, would
 * be telling a business it is subscribed before anyone has checked.
 */
export default function BillingLoading() {
  return (
    <AppShell>
      <PageHeader
        title="Billing & Usage"
        description="Your plan, what it includes, and what you are using."
        tight
      />

      <div aria-busy="true" aria-label="Loading billing">
        {/* The plan card. */}
        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Skeleton className="h-7 w-32" />
              <Skeleton className="mt-2 h-5 w-48" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <Skeleton className="mt-6 h-14 w-full rounded-[var(--radius-control)] sm:max-w-xs" />
        </Card>

        {/* What the plan includes, and what is used of it. */}
        <Skeleton className="mb-3 mt-8 h-4 w-28" />
        <Card pad="none" className="divide-y divide-[color:var(--rb-border-strong)] overflow-hidden">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex min-h-14 items-center justify-between gap-4 px-4 py-3">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </Card>
      </div>
    </AppShell>
  );
}
