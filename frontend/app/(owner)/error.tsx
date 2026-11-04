"use client";

import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { retryCopy } from "@/components/ui/retry-notice";
import { OwnerShell } from "@/features/dashboard/owner-shell";
import { useAutoRetry } from "@/lib/recovery/use-auto-retry";

/**
 * Owner error. Keep the tab bar. Do not dump the exception. Try again by
 * itself: after 3 s, 10 s and 30 s, counting down, with "Try now"; offline,
 * the moment the connection is back. Then stop and say so.
 *
 * A try is Next's `retry`: it fetches the page from the server again. `reset`
 * re-rendered what had already failed, so a page that failed on a moment's
 * database trouble kept failing until the owner reloaded it.
 */
export default function OwnerError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const pathname = usePathname();
  const auto = useAutoRetry({
    key: `owner:${pathname}`,
    failure: error,
    onRetry: retry,
  });
  const copy = retryCopy(auto);
  return (
    <OwnerShell>
      <div data-retry={auto.phase}>
        <EmptyState
          headingLevel="h1"
          title={copy.title}
          description={copy.body}
          action={
            <Button
              variant="action"
              size="lg"
              loading={auto.phase === "retrying"}
              loadingLabel="Trying again…"
              onClick={auto.retryNow}
            >
              {copy.action}
            </Button>
          }
        />
      </div>
    </OwnerShell>
  );
}
