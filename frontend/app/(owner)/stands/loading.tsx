import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { OwnerShell } from "@/features/dashboard/owner-shell";

/**
 * Set up while its data is in flight.
 *
 * The title, the steps card and the "Your Tags" heading are drawn for real
 * where they will stay (SetupSteps, TagsList). Only what depends on data is a
 * placeholder: three step rows at a real row's padding, and two Tag rows with
 * the square code tile.
 */
export default function SetupLoading() {
  return (
    <OwnerShell>
      <PageHeader title="Set up" description="Your customer page and your Tags, one step at a time." />
      <div aria-busy="true" aria-label="Loading Set up">
        <section className="mb-10">
          <Skeleton className="mb-3 h-5 w-24" />
          <ol className="divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
            {[0, 1, 2].map((row) => (
              <li key={row} className="p-5">
                <div className="flex items-start gap-4">
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="mt-2 h-5 w-full max-w-[26rem]" />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <p className="mb-3 text-sm font-medium text-muted">Your Tags</p>
          <ul className="divide-y divide-border border-y border-border">
            {[0, 1].map((row) => (
              <li key={row} className="flex min-h-[4.5rem] items-center gap-4 py-3.5">
                <Skeleton className="size-12 shrink-0 rounded-[12px]" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-5 w-36" />
                  <Skeleton className="mt-2 h-4 w-52 max-w-full" />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </OwnerShell>
  );
}
