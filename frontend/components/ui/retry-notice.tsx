"use client";

import { Button } from "@/components/ui/button";
import type { AutoRetry } from "@/lib/recovery/use-auto-retry";
import { recoveryWords as words } from "@/lib/recovery/words";

/**
 * The words for something that failed to load and is trying again by itself
 * (`useAutoRetry`): a title, a line, and the button's label.
 */
export function retryCopy(retry: AutoRetry): {
  title: string;
  body: string;
  action: string;
} {
  switch (retry.phase) {
    case "offline":
      return {
        title: words.offlineTitle,
        body: words.offlineBody,
        action: words.tryNow,
      };
    case "stopped":
      return {
        title: words.stoppedTitle,
        body: words.stoppedBody,
        action: words.tryAgain,
      };
    case "retrying":
      return {
        title: words.didNotLoad,
        body: words.retrying,
        action: words.tryNow,
      };
    case "waiting":
      return {
        title: words.didNotLoad,
        body: words.retryingIn(retry.secondsLeft),
        action: words.tryNow,
      };
  }
}

/**
 * A small part of a page that failed to load (the Tag's code, the customer
 * page editor): the line and the button, in the space the thing would fill.
 */
export function RetryNotice({
  retry,
  what,
  className,
}: {
  retry: AutoRetry;
  /** What failed, as the opening of the line: "The code didn’t load." */
  what: string;
  className?: string;
}) {
  const copy = retryCopy(retry);
  return (
    <div className={className} data-retry={retry.phase}>
      <p className="text-sm text-muted">
        {retry.phase === "offline" ? (
          words.offlineTry
        ) : retry.phase === "waiting" ? (
          <>
            {what}{" "}
            <span aria-hidden="true">{copy.body}</span>
            <span className="sr-only">{words.retryingSoon}</span>
          </>
        ) : (
          `${what} ${copy.body}`
        )}
      </p>
      <Button
        variant="secondary"
        size="sm"
        className="mt-3 w-auto"
        loading={retry.phase === "retrying"}
        loadingLabel={words.retrying}
        onClick={retry.retryNow}
      >
        {copy.action}
      </Button>
    </div>
  );
}
