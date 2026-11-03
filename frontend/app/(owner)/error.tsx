"use client";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { OwnerShell } from "@/features/dashboard/owner-shell";

/**
 * Owner error. Keep the tab bar. Say what to do. Do not dump the exception.
 *
 * "Try again" is Next's `retry`: it fetches the page from the server again.
 * `reset` re-rendered what had already failed, so a page that failed on a
 * moment's database trouble kept failing until the owner reloaded it.
 */
export default function OwnerError({ retry }: { retry: () => void }) {
  return (
    <OwnerShell>
      <EmptyState
        headingLevel="h1"
        title="That did not work"
        description="Try again. If it keeps happening, wait a moment and come back."
        action={
          <Button variant="action" size="lg" onClick={() => retry()}>
            Try again
          </Button>
        }
      />
    </OwnerShell>
  );
}
