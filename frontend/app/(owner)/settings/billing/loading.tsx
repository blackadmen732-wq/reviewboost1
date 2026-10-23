import { BackLink } from "@/components/ui/back-link";
import { Skeleton } from "@/components/ui/skeleton";
import { OwnerShell } from "@/features/dashboard/owner-shell";

/**
 * Billing while the plan loads: its own title and the plan card's shape. It
 * used to borrow Settings' placeholder, so the title read "Settings" and then
 * changed under the owner's eyes.
 */
export default function BillingLoading() {
  return (
    <OwnerShell>
      <BackLink href="/settings">Settings</BackLink>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Billing</h1>
        <p className="mt-1 text-base text-muted">Your plan, what it includes, and what you are using.</p>
      </div>
      <div className="flex flex-col gap-8" role="status" aria-busy="true" aria-label="Loading your plan">
        <section className="rounded-[var(--radius-card)] border border-border bg-surface p-5 sm:p-7">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="mt-3 h-5 w-64 max-w-full" />
          <Skeleton className="mt-6 h-14 w-full rounded-[var(--radius-control)] sm:w-56" />
        </section>
        <div className="grid gap-3 md:grid-cols-3">
          {[0, 1, 2].map((meter) => (
            <div key={meter} className="rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:p-5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-4 h-1.5 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </OwnerShell>
  );
}
