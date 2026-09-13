import { Skeleton } from "@/components/ui/skeleton";
import { AppShell } from "@/features/dashboard/app-shell";

export default function FeedbackDetailLoading() {
  return (
    <AppShell>
      <Skeleton className="mb-5 h-5 w-24" />

      <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-16 w-full" />
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-20 rounded-full" />
        <Skeleton className="h-9 w-32 rounded-[var(--radius-control)]" />
      </div>
    </AppShell>
  );
}
