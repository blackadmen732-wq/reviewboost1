import { BackLink } from "@/components/ui/back-link";
import { EditorSkeleton } from "@/features/customer-page/editor-skeleton";
import { OwnerShell } from "@/features/dashboard/owner-shell";

/** The customer page while it loads: the real title, then the editor's shape. */
export default function CustomerPageLoading() {
  return (
    <OwnerShell>
      <BackLink href="/stands">Set up</BackLink>
      <header className="mb-6">
        <h1 className="text-[length:var(--rb-text-display)] font-semibold tracking-[-0.03em] text-ink">
          Customer page
        </h1>
        <p className="mt-2 max-w-[40ch] text-base leading-relaxed text-muted">
          What customers see when they scan one of your Tags.
        </p>
      </header>
      <EditorSkeleton />
    </OwnerShell>
  );
}
