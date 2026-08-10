import { Hammer } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * An honest placeholder.
 *
 * A nav item that 404s makes the whole app feel broken, and a fake screen full
 * of dummy data is worse — it makes someone believe a feature works and then
 * discover it does not. This says plainly that it is being built and gives them
 * somewhere real to go, which costs nothing and keeps their trust intact.
 */

const COPY: Record<string, string> = {
  praise: "Where you will see the staff your customers named.",
  stands: "Where you will print and manage your codes.",
  settings: "Where you will change your business details.",
};

export function ComingSoon({ area }: { area: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface px-6 py-16 text-center">
      <div className="grid size-16 place-items-center rounded-full bg-quiet">
        <Hammer className="size-8 text-muted" aria-hidden="true" />
      </div>
      <p className="text-lg font-semibold text-ink">Being built</p>
      <p className="max-w-[28ch] text-base text-muted">{COPY[area] ?? "Coming soon."}</p>
      <Button variant="secondary" className="mt-2 w-auto" asChild>
        <Link href="/home">Back to home</Link>
      </Button>
    </div>
  );
}
