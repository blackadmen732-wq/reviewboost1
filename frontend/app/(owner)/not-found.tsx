import { ArrowLeft, SearchX } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AppShell } from "@/features/dashboard/app-shell";

/**
 * Something that is not there.
 *
 * Reached by `notFound()` — most often when an owner opens a link to a piece of
 * feedback that has since been deleted, or one belonging to a different
 * business. Both produce the same screen, and that is deliberate: RLS returns no
 * row for either, and distinguishing them would confirm that somebody else's
 * feedback exists.
 *
 * ON THE STATUS CODE
 * ------------------
 * This renders inside a route whose shell has already begun streaming, so the
 * response is committed as 200 before the check runs and Next cannot change it —
 * documented behaviour, not a defect. The mitigation the docs prescribe is
 * `noindex`, which every owner page already sets, and none of these screens is
 * reachable without a session anyway. The alternative — checking existence in
 * `proxy.ts` — would put a database round trip in front of every request in the
 * product to correct a status code no crawler will ever see.
 *
 * What matters is what it does *not* contain: no hint of what was asked for, and
 * none of the data that would have been on the real page.
 *
 * It keeps the normal navigation. Dropping someone onto a bare error page makes
 * a small mistake feel like a broken app; leaving the tab bar in place means the
 * way out is already under their thumb.
 */
export default function OwnerNotFound() {
  return (
    <AppShell>
      <EmptyState
        icon={SearchX}
        title="We could not find that"
        description="It may have been removed, or the link might be out of date."
        action={
          <Button asChild>
            <Link href="/home">
              <ArrowLeft className="size-5" aria-hidden="true" />
              Back to home
            </Link>
          </Button>
        }
      />
    </AppShell>
  );
}
