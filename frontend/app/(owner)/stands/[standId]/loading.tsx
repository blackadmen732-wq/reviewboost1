import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { OwnerShell } from "@/features/dashboard/owner-shell";

/**
 * One Tag while it loads.
 *
 * Mirrors TagDetail: the way back to Set up (real), the Tag's name and status
 * line, the code card with its square QR area and two buttons, and the NFC
 * section heading. The square keeps the card's height, so the page does not
 * grow when the code arrives.
 */
export default function TagLoading() {
  return (
    <OwnerShell>
      <p className="mb-4">
        <Link
          href="/stands"
          className="text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          Set up
        </Link>
      </p>
      <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading Tag">
        <header>
          <Skeleton className="h-8 w-56 max-w-full" />
          <Skeleton className="mt-3 h-5 w-72 max-w-full" />
        </header>
        <section className="max-w-[28rem] rounded-[var(--radius-card)] border border-border bg-surface p-5">
          <Skeleton className="mx-auto aspect-square w-full max-w-[280px] rounded-[var(--radius-control)]" />
          <div className="mt-5 flex flex-col gap-3">
            <Skeleton className="h-14 w-full rounded-[var(--radius-control)]" />
            <Skeleton className="h-14 w-full rounded-[var(--radius-control)]" />
          </div>
        </section>
        <section className="max-w-[28rem]">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-3 h-5 w-full" />
        </section>
      </div>
    </OwnerShell>
  );
}
