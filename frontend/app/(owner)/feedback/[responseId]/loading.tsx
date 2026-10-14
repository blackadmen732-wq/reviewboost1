import { ArrowLeft } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { OwnerShell } from "@/features/dashboard/owner-shell";

/**
 * One rating while it loads. The way back is real and already works; the
 * stars and the message are placeholders in the places they will fill. It used
 * to inherit the inbox's placeholder, a different shape from this page.
 */
export default function FeedbackDetailLoading() {
  return (
    <OwnerShell>
      <span className="mb-8 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted">
        <ArrowLeft className="size-4" aria-hidden="true" />
        All feedback
      </span>
      <div className="max-w-[36rem]" aria-busy="true" aria-label="Loading this rating">
        <div className="mb-4 flex items-center justify-between gap-3">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-16" />
        </div>
        <Skeleton className="h-5 w-full" />
        <Skeleton className="mt-2.5 h-5 w-2/3" />
      </div>
    </OwnerShell>
  );
}
