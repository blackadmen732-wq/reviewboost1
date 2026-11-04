import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { PublicShell } from "@/features/public/public-shell";
import { START_HREF } from "@/features/public/public-copy";

export const metadata: Metadata = {
  title: "Not found",
  robots: { index: false, follow: false },
};

/**
 * A missing public URL. Quiet. A way back. No owner chrome.
 */
export default function NotFound() {
  return (
    <PublicShell>
      <article className="mx-auto w-full max-w-[40rem] px-5 pb-24 pt-16 sm:px-8 sm:pt-20">
        <h1 className="text-[length:var(--rb-text-display)] font-semibold tracking-[-0.03em] text-ink">
          That page is not here
        </h1>
        <p className="mt-4 max-w-[36ch] text-lg leading-relaxed text-muted">
          The link may be out of date. The homepage still is.
        </p>
        <div className="mt-10 flex max-w-xs flex-col gap-3">
          <Button asChild variant="action">
            <Link href="/">Go to the homepage</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href={START_HREF}>Get started</Link>
          </Button>
        </div>
      </article>
    </PublicShell>
  );
}
