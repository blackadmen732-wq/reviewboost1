import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { FeedbackTabs } from "@/features/dashboard/feedback-tabs";
import { OwnerShell } from "@/features/dashboard/owner-shell";

/**
 * Feedback while its ratings are in flight.
 *
 * The title, the line under it and the tabs do not depend on the data, so they
 * are the real ones, drawn where they will stay. Only the rows are
 * placeholders, at a real row's height — nothing moves when they arrive.
 */
export default function FeedbackLoading() {
  return (
    <OwnerShell>
      <PageHeader title="Feedback" description="Ratings from your customers." />
      <FeedbackTabs />
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
