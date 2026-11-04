"use client";

import { LoaderCircle } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { RECHECK_SECONDS } from "@/lib/recovery/timing";
import { useAutoRetry } from "@/lib/recovery/use-auto-retry";
import type { OutcomeCheck } from "@/lib/recovery/use-outcome-check";
import { recoveryWords as words } from "@/lib/recovery/words";

/**
 * What the owner sees while the app finds out whether a change went through
 * (`useOutcomeCheck`). First "Checking whether that went through…". If the
 * server could not be reached, a countdown to checking again, with "Check
 * now". Nothing here asks the owner to go and look.
 */
export function OutcomeCheckNotice({
  check,
  className,
}: {
  check: OutcomeCheck;
  className?: string;
}) {
  if (check.phase === "idle") return null;
  if (check.unanswered === 0) {
    return (
      <p
        role="status"
        className={`flex items-center gap-2 text-sm text-muted ${className ?? ""}`}
        data-outcome-check="checking"
      >
        <LoaderCircle
          className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        {words.checking}
      </p>
    );
  }
  return <Unanswered check={check} className={className} />;
}

function Unanswered({
  check,
  className,
}: {
  check: OutcomeCheck;
  className?: string | undefined;
}) {
  const id = useId();
  const auto = useAutoRetry({
    key: `outcome-check:${id}`,
    failure: check.unanswered,
    onRetry: check.checkNow,
    delays: RECHECK_SECONDS,
  });
  const checking = check.phase === "checking";
  return (
    // Full width, so the box keeps its size while the button is away.
    <div className={`w-full ${className ?? ""}`} data-outcome-check={auto.phase}>
      <InlineNotice kind={auto.phase === "offline" ? "offline" : "info"}>
        {checking ? (
          <p>{words.checkingAgain}</p>
        ) : auto.phase === "offline" ? (
          <p>{words.offlineCheck}</p>
        ) : auto.phase === "stopped" ? (
          <p>{words.stillNoAnswer}</p>
        ) : (
          // The notice is a live region: a number that changes every second
          // would be read out every second. Screen readers get one sentence.
          <p>
            <span aria-hidden="true">{words.noAnswerIn(auto.secondsLeft)}</span>
            <span className="sr-only">{words.noAnswerSoon}</span>
          </p>
        )}
        {/* Not while it checks: the line already says "Checking again…".
            Big, but not black: the app checks by itself, and the screen's
            black button is its own main action. */}
        {checking ? null : (
          <Button variant="secondary" className="mt-3" onClick={auto.retryNow}>
            {auto.phase === "stopped" ? words.checkAgain : words.checkNow}
          </Button>
        )}
      </InlineNotice>
    </div>
  );
}
