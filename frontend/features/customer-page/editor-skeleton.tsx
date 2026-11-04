import { Skeleton } from "@/components/ui/skeleton";

/**
 * The editor while its draft loads: the photo buttons, the guidance lines,
 * Publish, and a phone the size of the real preview. It used to be one line
 * of text, and the phone then pushed in and the page grew by a screen.
 */
export function EditorSkeleton() {
  return (
    <div
      className="grid gap-6 pb-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)] lg:gap-8 lg:pb-0"
      role="status"
      aria-busy="true"
      aria-label="Loading your customer page"
    >
      <div className="lg:pt-8">
        <div className="flex items-center gap-2 sm:gap-3">
          <Skeleton className="h-11 flex-1 rounded-[var(--radius-control)]" />
          <Skeleton className="h-11 flex-1 rounded-[var(--radius-control)]" />
        </div>
        <Skeleton className="mt-3 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-3/4" />
        <Skeleton className="mt-6 hidden h-14 w-full rounded-[var(--radius-control)] lg:block" />
      </div>
      <div className="min-w-0">
        <Skeleton className="mx-auto mb-3 h-3 w-32" />
        {/* The editor phone's own widths (customer-page.css .phone-frame--editor). */}
        <Skeleton className="mx-auto aspect-[442/886] w-[min(100%,clamp(250px,40vw+128px,305px))] rounded-[2.75rem] lg:w-[min(100%,340px)]" />
      </div>
    </div>
  );
}
