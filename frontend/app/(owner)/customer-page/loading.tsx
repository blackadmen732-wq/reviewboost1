import { AppShell } from "@/features/dashboard/app-shell";

export default function CustomerPageLoading() {
  return (
    <AppShell>
      <div className="mb-2 h-8 w-48 animate-pulse rounded bg-border/50" />
      <div className="mb-6 h-5 w-72 animate-pulse rounded bg-border/30" />

      <div className="flex flex-col gap-6">
        {/* Hero photo skeleton */}
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
          <div className="mb-3 h-4 w-24 animate-pulse rounded bg-border/50" />
          <div className="aspect-[16/9] w-full animate-pulse rounded-[var(--radius-control)] bg-border/30" />
        </div>

        {/* Logo skeleton */}
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
          <div className="mb-3 h-4 w-16 animate-pulse rounded bg-border/50" />
          <div className="flex items-center gap-4">
            <div className="size-16 animate-pulse rounded-full bg-border/30" />
            <div className="flex-1">
              <div className="h-4 w-24 animate-pulse rounded bg-border/30" />
            </div>
          </div>
        </div>

        {/* Business name skeleton */}
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
          <div className="mb-2 h-4 w-32 animate-pulse rounded bg-border/50" />
          <div className="h-6 w-48 animate-pulse rounded bg-border/30" />
        </div>
      </div>
    </AppShell>
  );
}
