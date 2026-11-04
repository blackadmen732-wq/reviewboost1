"use client";

import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { retryCopy } from "@/components/ui/retry-notice";
import { useAutoRetry } from "@/lib/recovery/use-auto-retry";

const TRIES = "rb-unavailable-tries";
const FORGET_AFTER_MS = 2 * 60_000;

/** Tries made before the last reload, from this tab's session storage. */
function triesBefore(): number {
  try {
    const raw = sessionStorage.getItem(TRIES);
    if (!raw) return 0;
    const { count, at } = JSON.parse(raw) as { count: number; at: number };
    return Date.now() - at < FORGET_AFTER_MS ? count : 0;
  } catch {
    return 0;
  }
}

function reloadCounting() {
  try {
    sessionStorage.setItem(TRIES, JSON.stringify({ count: triesBefore() + 1, at: Date.now() }));
  } catch {
    /* Without storage it still tries; it just cannot count past a reload. */
  }
  window.location.reload();
}

const noSubscription = () => () => {};

/**
 * Each try reloads the page asked for, so the count of tries is kept in the
 * tab's session storage: 3 s, then 10 s, then 30 s, then it stops and leaves
 * "Try again" to the owner.
 */
export function UnavailableRetry() {
  const startAt = useSyncExternalStore(noSubscription, triesBefore, () => -1);
  if (startAt < 0) return null;
  return <Countdown startAt={startAt} />;
}

function Countdown({ startAt }: { startAt: number }) {
  const retry = useAutoRetry({
    key: "unavailable",
    failure: null,
    onRetry: reloadCounting,
    startAt,
  });
  const copy = retryCopy(retry);
  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-4" data-retry={retry.phase}>
      <p className="text-base text-muted">{copy.body}</p>
      <Button
        variant="secondary"
        className="w-auto"
        loading={retry.phase === "retrying"}
        loadingLabel="Trying again…"
        onClick={retry.retryNow}
      >
        {copy.action}
      </Button>
    </div>
  );
}
