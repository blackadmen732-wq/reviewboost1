import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { OwnerShell } from "@/features/dashboard/owner-shell";

/**
 * One Tag while it is in flight.
 *
 * The back link is real — it works before the Tag has loaded, which is the
 * one thing somebody who opened the wrong Tag wants.
 */
export default function TagDetailLoading() {
  return (
    <OwnerShell>
      <p className="mb-4">
        <Link
          href="/stands"
          className="text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          Tags
        </Link>
      </p>

      <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading this tag">
        <header>
          <Skeleton className="h-8 w-52" />
          <Skeleton className="mt-2 h-5 w-72" />
        </header>

        {/* The code card: a square for the code, then the two actions. */}
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
          <Skeleton className="mx-auto aspect-square w-full max-w-[280px] rounded-[var(--radius-control)]" />
          <Skeleton className="mt-6 h-14 w-full rounded-[var(--radius-control)]" />
          <Skeleton className="mt-3 h-14 w-full rounded-[var(--radius-control)]" />
        </div>

        <Skeleton className="h-14 w-full rounded-[var(--radius-control)]" />
      </div>
    </OwnerShell>
  );
}
