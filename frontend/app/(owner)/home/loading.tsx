import { OwnerShell } from "@/features/dashboard/owner-shell";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Home while its data is in flight. Same vertical rhythm as the real page.
 */
export default function HomeLoading() {
  return (
    <OwnerShell>
      <header className="mb-10">
        <Skeleton className="h-8 w-48" />
      </header>
      <div className="max-w-[36rem]">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-3 h-5 w-72" />
        <Skeleton className="mt-8 h-16 w-full max-w-xs rounded-[var(--radius-control)]" />
      </div>
    </OwnerShell>
  );
}
