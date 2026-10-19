import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { AppShell } from "@/features/dashboard/app-shell";

/**
 * Text Requests while the balance, Tags and recent texts load.
 *
 * The header is the real one. Below it: the balance line, the form's fields
 * and its button, then three recent rows, at the composer's sizes.
 */
export default function TextRequestsLoading() {
  return (
    <AppShell>
      <PageHeader
        title="Text Requests"
        description="Send a customer the link to your Tag. One message, one review request."
      />
      <div className="max-w-[36rem]" aria-busy="true" aria-label="Loading Text Requests">
        <Skeleton className="h-5 w-52" />
        <div className="mt-6 flex flex-col gap-4">
          <Skeleton className="h-14 w-full rounded-[var(--radius-control)]" />
          <Skeleton className="h-14 w-full rounded-[var(--radius-control)]" />
          <Skeleton className="h-14 w-full max-w-sm rounded-[var(--radius-control)]" />
        </div>
        <div className="mt-10 divide-y divide-border border-y border-border">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex min-h-14 flex-col justify-center gap-2 py-3.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-56 max-w-full" />
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
