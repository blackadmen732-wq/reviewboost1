import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { FeedbackTabs } from "@/features/dashboard/feedback-tabs";
import { OwnerShell } from "@/features/dashboard/owner-shell";

/**
 * Insights while its figures are in flight: the real title and tabs, and
 * placeholders the size of the period control, the average and the chart.
 * Without its own, Insights borrowed the inbox's rows, which the page then
 * replaced with something a different shape.
 */
export default function InsightsLoading() {
  return (
    <OwnerShell>
      <PageHeader title="Feedback" description="Ratings from your customers." />
      <FeedbackTabs active="insights" />
      <div className="flex flex-col gap-10" role="status" aria-busy="true" aria-label="Loading insights">
        <Skeleton className="h-[3.25rem] w-full rounded-full sm:w-[19rem]" />
        <div>
          <Skeleton className="h-14 w-32" />
          <Skeleton className="mt-3 h-5 w-64 max-w-full" />
        </div>
        <Skeleton className="h-40 w-full rounded-[var(--radius-control)] sm:h-52" />
      </div>
    </OwnerShell>
  );
}
