import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { FeedbackTabs } from "@/features/dashboard/feedback-tabs";
import { OwnerShell } from "@/features/dashboard/owner-shell";

/**
 * Feedback while its ratings are in flight.
 *
 * The title, the line under it and the tabs do not depend on the data, so they
 * are the real ones, drawn where they will stay. Only the summary card and the
 * rows are placeholders, at their real heights — nothing moves when they
 * arrive. The card has to be here: without it the rows paint at the top and
 * are then pushed down the page.
 */
export default function FeedbackLoading() {
  return (
    <OwnerShell>
      <PageHeader title="Feedback" description="Ratings from your customers." />
      <FeedbackTabs />
      <Card as="section" className="mb-8">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div className="flex items-baseline gap-5">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-4 w-20" />
          </div>
          <Skeleton className="h-5 w-24" />
        </div>
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="flex min-h-11 items-center gap-3">
            <Skeleton className="h-4 w-10 shrink-0" />
            <Skeleton className="h-2 flex-1 rounded-full" />
            <Skeleton className="h-4 w-10 shrink-0" />
          </div>
        ))}
      </Card>

      <div className="divide-y divide-border border-y border-border" aria-busy="true" aria-label="Loading ratings">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex min-h-14 flex-col justify-center gap-2 py-3.5 pl-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-full max-w-[28rem]" />
          </div>
        ))}
      </div>
    </OwnerShell>
  );
}
