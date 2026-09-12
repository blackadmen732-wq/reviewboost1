"use client";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { OwnerShell } from "@/features/dashboard/owner-shell";

/**
 * Owner error. Keep the tab bar. Say what to do. Do not dump the exception.
 */
export default function OwnerError({ reset }: { reset: () => void }) {
  return (
    <OwnerShell>
      <EmptyState
        title="That did not work"
        description="Try again. If it keeps happening, wait a moment and come back."
        action={
          <Button variant="action" size="lg" onClick={reset}>
            Try again
          </Button>
        }
      />
    </OwnerShell>
  );
}
