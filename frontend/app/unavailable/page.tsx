import type { Metadata } from "next";
import { CloudOff } from "lucide-react";

import { UnavailableRetry } from "@/features/public/unavailable-retry";
import { recoveryWords as words } from "@/lib/recovery/words";

export const metadata: Metadata = {
  title: words.unansweredTitle,
  robots: { index: false, follow: false },
};

/**
 * Shown in place of an owner page when the auth service did not answer
 * (proxy.ts rewrites to it; the address stays the page that was asked for).
 * Fails closed, so nothing of the owner's is here, but it does not pretend the
 * owner was signed out: it says what is true and loads the page by itself as
 * soon as ReviewBoost answers again.
 */
export default function UnavailablePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-5 text-center">
      <div className="grid size-20 place-items-center rounded-full bg-quiet">
        <CloudOff className="size-9 text-muted" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em] text-ink">
          {words.unansweredTitle}
        </h1>
        <p className="text-base text-muted">{words.unansweredBody}</p>
      </div>
      <UnavailableRetry />
    </main>
  );
}
