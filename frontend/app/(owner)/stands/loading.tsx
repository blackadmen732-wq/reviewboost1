import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { OwnerShell } from "@/features/dashboard/owner-shell";

/**
 * Tags while the list is in flight.
 *
 * The title and its line are static, so they are the real ones. Rows match
 * TagsList: min-h-[4.5rem], a 48px square code tile, then two lines.
 */
export default function TagsLoading() {
  return (
    <OwnerShell>
      <PageHeader
        title="Tags"
        description="Print a code or program a Tag. Put it where people pay."
      />
      <ul
        className="divide-y divide-border border-y border-border"
        aria-busy="true"
        aria-label="Loading tags"
      >
        {[0, 1, 2].map((row) => (
          <li key={row} className="flex min-h-[4.5rem] items-center gap-4 py-3.5">
            <Skeleton className="size-12 shrink-0 rounded-[12px]" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-56" />
            </div>
          </li>
        ))}
      </ul>
    </OwnerShell>
  );
}
