import Link from "next/link";
import { Button } from "@/components/ui/button";

import type { Metadata } from "next";
import { WifiOff } from "lucide-react";

export const metadata: Metadata = {
  title: "No connection",
  robots: { index: false, follow: false },
};

/**
 * The offline fallback.
 *
 * Contains no data by design — it is cached and served to whoever is holding
 * the device, so anything personal on it would be a leak.
 *
 * Says what happened and what to do, and nothing else. "Something went wrong"
 * would be a lie: the app is fine, the connection is not, and the difference
 * decides whether someone retries or gives up.
 *
 * It does not wait for a tap: the moment the connection is back, it loads the
 * page that was asked for (the address still says which). An inline script,
 * because this page is cached for offline use and its scripts may not be.
 */
const RELOAD_WHEN_ONLINE = "addEventListener('online',function(){location.reload()})";
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-5 text-center">
      <div className="grid size-20 place-items-center rounded-full bg-quiet">
        <WifiOff className="size-9 text-muted" aria-hidden="true" />
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em] text-ink">
          You are offline
        </h1>
        <p className="text-base text-muted">
          Check your connection. This page loads by itself when you’re back
          online.
        </p>
      </div>
      <script dangerouslySetInnerHTML={{ __html: RELOAD_WHEN_ONLINE }} />
      <Button asChild variant="secondary" className="w-auto">
        <Link href="/home">Try Home again</Link>
      </Button>
    </main>
  );
}
