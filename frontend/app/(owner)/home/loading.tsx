import { AppShell } from "@/features/dashboard/app-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function HomeLoading() {
  return (
    <AppShell>
      <header className="mb-8 flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-7 w-48 lg:h-8" />
        </div>
        <Skeleton className="size-11 shrink-0 rounded-full lg:hidden" />
      </header>

      <section className="mb-8 grid grid-cols-2 gap-3 lg:gap-4">
        {[0, 1].map((tile) => (
          <div
            key={tile}
            className="flex min-h-[7.5rem] flex-col justify-between rounded-[var(--radius-card)] border border-border bg-surface p-4"
          >
            <Skeleton className="size-10 rounded-full" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-9 w-14" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        ))}
      </section>

      <Skeleton className="h-16 w-full rounded-[16px] lg:w-[280px]" />
    </AppShell>
  );
}
