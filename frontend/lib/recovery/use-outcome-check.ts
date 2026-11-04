"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { checkOutcome, type IsDone } from "@/lib/recovery/check-outcome";

/**
 * After a change's answer is lost, find out what happened, without asking.
 *
 * `start(isDone)` checks at once (`checkOutcome`, under 10 s). Found: `onDone`,
 * and the screen shows what it shows after any success. Not there: `onNotDone`,
 * and the action is offered again, safely, since it did not happen. No answer
 * at all: the phase becomes "unanswered" and `OutcomeCheckNotice` counts down
 * to checking again (10 s, then 30 s, or as soon as the connection is back).
 *
 * While `pending`, the screen holds its action, so a change that may already
 * have happened is never sent twice.
 */
export type OutcomeCheckPhase = "idle" | "checking" | "unanswered";

export interface OutcomeCheck {
  phase: OutcomeCheckPhase;
  /** Checks so far that got no answer; it changes with each one. */
  unanswered: number;
  /** From the lost answer until the outcome is known. */
  pending: boolean;
  /**
   * `serverAnswered`: the change came back with a server error rather than no
   * answer, so one read settles it (see `checkOutcome`).
   */
  start: (isDone: IsDone, options?: { serverAnswered?: boolean }) => void;
  checkNow: () => void;
}

export function useOutcomeCheck({
  onDone,
  onNotDone,
  onExpired,
}: {
  onDone: () => void;
  onNotDone: () => void;
  /** The session ran out while checking: nothing more can be learned. */
  onExpired: (message: string) => void;
}): OutcomeCheck {
  const [state, setState] = useState<{
    phase: OutcomeCheckPhase;
    unanswered: number;
  }>({ phase: "idle", unanswered: 0 });
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
      const outcome = await checkOutcome(read, {
        serverAnswered: serverAnswered.current,
      });
      if (outcome === "unknown") {
        setState((current) => ({
          phase: "unanswered",
          unanswered: current.unanswered + 1,
        }));
        return;
      }
      isDone.current = null;
      setState({ phase: "idle", unanswered: 0 });
      if (outcome === "done") callbacks.current.onDone();
      else callbacks.current.onNotDone();
    } catch (caught) {
      // Only an expired session gets here: checkOutcome keeps the rest.
      isDone.current = null;
      setState({ phase: "idle", unanswered: 0 });
      callbacks.current.onExpired(
        caught instanceof Error
          ? caught.message
          : "Your session expired. Sign in again, then try.",
      );
    } finally {
      running.current = false;
    }
  }, []);

  const start = useCallback(
    (read: IsDone, options?: { serverAnswered?: boolean }) => {
      isDone.current = read;
      serverAnswered.current = options?.serverAnswered ?? false;
      setState({ phase: "checking", unanswered: 0 });
      void run();
    },
    [run],
  );
  const checkNow = useCallback(() => void run(), [run]);

  return {
    ...state,
    pending: state.phase !== "idle",
    start,
    checkNow,
  };
}
