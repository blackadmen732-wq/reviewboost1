import { Skeleton } from "@/components/ui/skeleton";
import { AppShell } from "@/features/dashboard/app-shell";

export default function SettingsLoading() {
  return (
    <AppShell>
      <Skeleton className="mb-6 h-7 w-24" />

      <div className="mb-6 flex flex-col gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-[var(--radius-card)] border border-border bg-surface p-4"
          >
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <Skeleton className="mb-1.5 h-4 w-16" />
                <Skeleton className="h-5 w-40" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="mb-3 h-4 w-12" />
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-[var(--radius-card)] border border-border bg-surface p-4"
          >
            <div className="flex items-center gap-4">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <Skeleton className="mb-1 h-5 w-36" />
                <Skeleton className="h-4 w-48" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
