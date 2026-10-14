"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { PublicShell } from "@/features/public/public-shell";

/**
 * Public error. Quiet. A way back. No owner chrome, no exception text.
 */
export default function PublicError({ reset }: { reset: () => void }) {
  return (
    <PublicShell>
      <article className="mx-auto w-full max-w-[40rem] px-5 pb-24 pt-16 sm:px-8 sm:pt-20">
        <h1 className="text-[length:var(--rb-text-display)] font-semibold tracking-[-0.03em] text-ink">
          That did not work
        </h1>
        <p className="mt-4 max-w-[36ch] text-lg leading-relaxed text-muted">
          Try again. The homepage still is.
        </p>
        <div className="mt-10 flex max-w-xs flex-col gap-3">
          <Button variant="action" onClick={reset}>
            Try again
          </Button>
          <Button asChild variant="ghost">
            <Link href="/">Go to the homepage</Link>
          </Button>
        </div>
      </article>
    </PublicShell>
  );
}
