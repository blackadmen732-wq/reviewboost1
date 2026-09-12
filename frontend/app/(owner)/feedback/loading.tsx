import { OwnerShell } from "@/features/dashboard/owner-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function FeedbackLoading() {
  return (
    <OwnerShell>
      <Skeleton className="mb-10 h-8 w-40" />
      <div className="divide-y divide-border border-y border-border">
        {[0, 1, 2].map((row) => (
          <div key={row} className="py-4">
            <Skeleton className="mb-2 h-4 w-24" />
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    </OwnerShell>
  );
}
