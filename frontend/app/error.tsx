"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { retryCopy } from "@/components/ui/retry-notice";
import { PublicShell } from "@/features/public/public-shell";
import { useAutoRetry } from "@/lib/recovery/use-auto-retry";

/**
 * Public error. Quiet. A way back. No owner chrome, no exception text. Tries
 * again by itself, like the owner error page: after 3 s, 10 s and 30 s, or
 * the moment the connection is back, then stops and says so.
 *
 * A try is Next's `retry`, which asks the server again. `reset` only
 * re-rendered what already failed, so a page that failed on a server read
 * failed again on every tap.
 */
export default function PublicError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const pathname = usePathname();
  const auto = useAutoRetry({
    key: `public:${pathname}`,
    failure: error,
    onRetry: retry,
  });
  const copy = retryCopy(auto);
  return (
    <PublicShell>
      <article
        className="mx-auto w-full max-w-[40rem] px-5 pb-24 pt-16 sm:px-8 sm:pt-20"
        data-retry={auto.phase}
      >
        <h1 className="text-[length:var(--rb-text-display)] font-semibold tracking-[-0.03em] text-ink">
          {copy.title}
        </h1>
        <p className="mt-4 max-w-[36ch] text-lg leading-relaxed text-muted">
          {copy.body}
        </p>
        <div className="mt-10 flex max-w-xs flex-col gap-3">
          <Button
            variant="action"
            loading={auto.phase === "retrying"}
            loadingLabel="Trying again…"
            onClick={auto.retryNow}
          >
            {copy.action}
          </Button>
          <Button asChild variant="ghost">
            <Link href="/">Go to the homepage</Link>
          </Button>
        </div>
      </article>
    </PublicShell>
  );
}
