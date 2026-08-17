import { AppShell } from "@/features/dashboard/app-shell";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Feedback while loading.
 *
 * Three rows, not ten. A skeleton longer than the real list makes the page
 * appear to shrink when data lands, and a shrinking page reads as content being
 * taken away.
 */
export default function FeedbackLoading() {
  return (
    <AppShell>
      <Skeleton className="mb-6 h-8 w-40" />

      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((row) => (
          <div key={row} className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-3/5" />
          </div>
        ))}
      </div>
    </AppShell>
  );
}
