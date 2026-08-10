import { AppShell } from "@/features/dashboard/app-shell";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Home while its data is in flight.
 *
 * The shape is deliberately identical to the real page — same card heights,
 * same grid, same spacing. A skeleton that does not match causes a visible jump
 * when content lands, which reads as a bug even though nothing failed.
 *
 * This is the screen an owner sees for the first second on restaurant wifi.
 * Without it, they see cream nothing and assume the app is broken. With it,
 * they see the app already there, filling in.
 *
 * The navigation renders for real rather than as skeleton: it is already known,
 * and greying out something we can show is a lie about what is loading.
 */
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

      <div className="mb-8 grid gap-4 lg:grid-cols-[1fr_1fr] lg:items-stretch">
        <section className="rounded-[var(--radius-card)] border border-border bg-surface p-6 shadow-[var(--shadow-card)] lg:flex lg:flex-col lg:justify-center lg:p-10">
          <div className="flex flex-col items-center gap-3">
            <Skeleton className="h-14 w-32" />
            <Skeleton className="h-5 w-40" />
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-1 lg:gap-4">
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
      </div>

      <Skeleton className="h-16 w-full rounded-[16px] lg:w-[280px]" />
    </AppShell>
  );
}
