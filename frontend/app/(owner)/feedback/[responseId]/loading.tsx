import { BackLink } from "@/components/ui/back-link";
import { Skeleton } from "@/components/ui/skeleton";
import { OwnerShell } from "@/features/dashboard/owner-shell";

/**
 * One rating while it loads. The way back is real and already works; the
 * stars, the time line, the message and the sorted row are placeholders in
 * the places they will fill, at their sizes. It used to inherit the inbox's
 * placeholder, a different shape from this page.
 */
export default function FeedbackDetailLoading() {
  return (
    <OwnerShell>
      <BackLink href="/feedback">Feedback</BackLink>
      <h1 className="sr-only">Rating</h1>
      <div className="max-w-[36rem]" role="status" aria-busy="true" aria-label="Loading this rating">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="mt-3 h-5 w-48" />
        <Skeleton className="mt-5 h-6 w-full" />
        <Skeleton className="mt-2.5 h-6 w-2/3" />
        <div className="mt-6 flex items-center justify-between gap-3 border-y border-border py-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-14 w-44 rounded-[var(--radius-control)]" />
        </div>
      </div>
    </OwnerShell>
  );
}
