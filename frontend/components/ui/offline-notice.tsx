"use client";

import { Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

import { useOnline } from "@/lib/recovery/use-online";
import { recoveryWords as words } from "@/lib/recovery/words";

/** How long "Back online." stays before the bar goes. */
const BACK_ONLINE_MS = 3_000;

/**
 * A bar along the top while the phone or computer has no connection, so a
 * failure is explained before it happens: nothing saves offline, and the app
 * says so rather than letting a tap fail. When the connection comes back it
 * says "Back online." for three seconds, and what failed tries again by
 * itself (`useAutoRetry`).
 */
export function OfflineNotice() {
  const online = useOnline();
  const [wasOffline, setWasOffline] = useState(false);
  const [back, setBack] = useState(false);
  if (!online && !wasOffline) {
    setWasOffline(true);
    setBack(false);
  }
  if (online && wasOffline) {
    setWasOffline(false);
    setBack(true);
  }

  useEffect(() => {
    if (!back) return;
    const timer = setTimeout(() => setBack(false), BACK_ONLINE_MS);
    return () => clearTimeout(timer);
  }, [back]);

  if (online && !back) return null;
  const Icon = online ? Wifi : WifiOff;
  return (
    <div
      role="status"
      className="sticky top-0 z-40 flex items-center justify-center gap-2 border-b border-border bg-surface px-5 py-2.5 text-center text-sm font-medium text-ink text-balance"
      data-connection={online ? "back" : "offline"}
    >
      <Icon className="size-4 shrink-0 text-info" aria-hidden="true" />
      {online ? words.backOnline : words.offlineBanner}
    </div>
  );
}
