import { BackLink } from "@/components/ui/back-link";
import { Skeleton } from "@/components/ui/skeleton";
import { OwnerShell } from "@/features/dashboard/owner-shell";

/**
 * One Tag while it loads.
 *
 * Mirrors TagDetail: the way back to Set up (real), the Tag's name and status
 * line, the code card with its square QR area and two buttons, and the NFC
 * section with its heading, line and button. The square keeps the card's
 * height, so the page does not grow when the code arrives.
 */
export default function TagLoading() {
  return (
    <OwnerShell>
      <BackLink href="/stands">Set up</BackLink>
      <h1 className="sr-only">Tag</h1>
      <div className="flex flex-col gap-8" role="status" aria-busy="true" aria-label="Loading Tag">
        <header>
          <Skeleton className="h-8 w-56 max-w-full" />
          <Skeleton className="mt-3 h-5 w-72 max-w-full" />
        </header>
        <section className="max-w-[28rem] rounded-[var(--radius-card)] border border-border bg-surface p-5">
          <Skeleton className="mx-auto aspect-square w-full max-w-[280px] rounded-[var(--radius-control)]" />
          <div className="mt-5 flex flex-col gap-3">
            <Skeleton className="h-16 w-full rounded-[var(--radius-control)]" />
            <Skeleton className="h-14 w-full rounded-[var(--radius-control)]" />
          </div>
        </section>
        <section className="max-w-[28rem]">
          <Skeleton className="h-5 w-12" />
          <Skeleton className="mt-2 h-5 w-full" />
          <Skeleton className="mt-4 h-14 w-full rounded-[var(--radius-control)]" />
        </section>
      </div>
    </OwnerShell>
  );
}
