"use client";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AppShell } from "@/features/dashboard/app-shell";

export default function OwnerError({ reset }: { reset: () => void }) {
  return (
    <AppShell>
      <EmptyState
        title="That did not work"
        description="Try again. If it keeps happening, wait a moment and come back."
        action={
          <Button variant="primary" size="lg" onClick={reset}>
            Try again
          </Button>
        }
      />
    </AppShell>
  );
}
