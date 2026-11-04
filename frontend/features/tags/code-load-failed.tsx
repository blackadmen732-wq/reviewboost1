"use client";

import { RetryNotice } from "@/components/ui/retry-notice";
import { useAutoRetry } from "@/lib/recovery/use-auto-retry";

/**
 * The Tag's code could not load. It tries again by itself (3 s, 10 s, 30 s,
 * or as soon as the connection is back) instead of waiting for a tap.
 */
export function CodeLoadFailed({
  standId,
  failures,
  onReload,
}: {
  standId: string;
  /** From `useAuthenticatedQr`: changes with each failed load. */
  failures: number;
  onReload: () => void;
}) {
  const retry = useAutoRetry({
    key: `code:${standId}`,
    failure: failures,
    onRetry: onReload,
  });
  return (
    <RetryNotice
      retry={retry}
      what="The code didn’t load."
      className="flex flex-col items-center text-center"
    />
  );
}
