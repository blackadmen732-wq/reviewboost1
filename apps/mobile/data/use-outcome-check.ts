import { useCallback, useEffect, useRef, useState } from "react";

import { checkOutcome, type IsDone } from "./recovery";

/**
 * After a change's answer is lost, find out what happened, without asking:
 * `start(isDone)` checks (under 10 s); found, `onDone`; not there, `onNotDone`
 * and the action is offered again, safely; no answer at all, the phase is
 * "unanswered" and `OutcomeCheckNotice` counts down to checking again. While
 * `pending`, hold the action, so nothing is ever done twice. The same as the
 * website's `useOutcomeCheck`.
 */
export type OutcomeCheckPhase = "idle" | "checking" | "unanswered";

export interface OutcomeCheck {
  phase: OutcomeCheckPhase;
  unanswered: number;
  pending: boolean;
  /**
   * `waitFirst`: a check already ran and got no answer (the data layer's own),
   * so begin with the countdown to the next one rather than check at once.
   */
  start: (isDone: IsDone, options?: { serverAnswered?: boolean; waitFirst?: boolean }) => void;
  checkNow: () => void;
}

export function useOutcomeCheck({
  onDone,
  onNotDone,
  onExpired,
}: {
  onDone: () => void;
  onNotDone: () => void;
  onExpired: (message: string) => void;
}): OutcomeCheck {
  const [state, setState] = useState<{ phase: OutcomeCheckPhase; unanswered: number }>({
    phase: "idle",
    unanswered: 0,
  });
  const isDone = useRef<IsDone | null>(null);
  const serverAnswered = useRef(false);
  const running = useRef(false);
  const callbacks = useRef({ onDone, onNotDone, onExpired });
  useEffect(() => {
    callbacks.current = { onDone, onNotDone, onExpired };
  });

  const run = useCallback(async () => {
    const read = isDone.current;
    if (!read || running.current) return;
    running.current = true;
    setState((current) => ({ ...current, phase: "checking" }));
    try {
      const outcome = await checkOutcome(read, { serverAnswered: serverAnswered.current });
      if (outcome === "unknown") {
        setState((current) => ({ phase: "unanswered", unanswered: current.unanswered + 1 }));
        return;
      }
      isDone.current = null;
      setState({ phase: "idle", unanswered: 0 });
      if (outcome === "done") callbacks.current.onDone();
      else callbacks.current.onNotDone();
    } catch {
      // Only a signed-out session gets here.
      isDone.current = null;
      setState({ phase: "idle", unanswered: 0 });
      callbacks.current.onExpired("Your session expired. Sign in again, then try.");
    } finally {
      running.current = false;
    }
  }, []);

  const start = useCallback(
    (read: IsDone, options?: { serverAnswered?: boolean; waitFirst?: boolean }) => {
      isDone.current = read;
      serverAnswered.current = options?.serverAnswered ?? false;
      if (options?.waitFirst) {
        setState({ phase: "unanswered", unanswered: 1 });
        return;
      }
      setState({ phase: "checking", unanswered: 0 });
      void run();
    },
    [run],
  );
  const checkNow = useCallback(() => void run(), [run]);

  return { ...state, pending: state.phase !== "idle", start, checkNow };
}
