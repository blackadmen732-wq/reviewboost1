import { Skeleton } from "@/components/ui/skeleton";
import { AppShell } from "@/features/dashboard/app-shell";

export default function StandsLoading() {
  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <Skeleton className="h-7 w-32" />
          <Skeleton className="mt-1 h-5 w-56" />
        </div>
      </div>

      <div className="flex flex-col gap-5">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-[var(--shadow-card)]"
          >
            <div className="mb-4">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="mt-1.5 h-4 w-40" />
            </div>
            <Skeleton className="mx-auto aspect-square w-full max-w-[240px] rounded-[var(--radius-control)]" />
          </div>
        ))}
      </div>
    </AppShell>
  );
}
