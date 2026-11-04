import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { OwnerShell } from "@/features/dashboard/owner-shell";

/**
 * Settings while the business and its Google link load. The title is real;
 * each section is a heading line, a field, and space, at the form's sizes.
 * Also covers Settings' sub-pages (billing, delete) while they load.
 */
export default function SettingsLoading() {
  return (
    <OwnerShell>
      <PageHeader title="Settings" />
      <div className="flex max-w-[36rem] flex-col gap-10" role="status" aria-busy="true" aria-label="Loading Settings">
        {[0, 1, 2].map((section) => (
          <section key={section}>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-3 h-14 w-full rounded-[var(--radius-control)]" />
            <Skeleton className="mt-3 h-4 w-64 max-w-full" />
          </section>
        ))}
      </div>
    </OwnerShell>
  );
}
