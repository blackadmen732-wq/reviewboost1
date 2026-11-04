"use client";

import { useSyncExternalStore } from "react";

import { formatWhen, formatWhenStable } from "@/features/connections/connection-words";

const noSubscription = () => () => {};

/**
 * A time in the viewer's own zone ("24 minutes ago", "Nov 2, 3:04 PM").
 *
 * The server runs in UTC and the owner does not, so formatting during server
 * rendering printed a different time than the browser did and React reported
 * a hydration mismatch on every Connections page with a sync. The server and
 * the first browser pass print the same stable date; the browser then fills
 * in the local time.
 */
export function When({ value }: { value: string | null }) {
  const inBrowser = useSyncExternalStore(noSubscription, () => true, () => false);
  if (!value) return <>Not yet</>;
  return <time dateTime={value}>{inBrowser ? formatWhen(value) : formatWhenStable(value)}</time>;
}
