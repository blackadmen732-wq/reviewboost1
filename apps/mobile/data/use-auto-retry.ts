import { useCallback, useEffect, useRef, useState } from "react";

import { onBackOnline, useOnline } from "./connection";
import { AUTO_RETRY_SECONDS } from "./recovery";

/**
 * A screen that failed to load tries again by itself: after 3 s, then 10 s,
 * then 30 s, counting down, with "Try now" to skip the wait. Then it stops
 * and says so. Offline it does not count down: it tries the moment the
 * connection is back. The same as the website's (`frontend/lib/recovery`).
 *
 * The number of tries is kept outside the component, under `key`, because a
 * screen shows its spinner while it reloads, and the failed notice that comes
 * back is a new component: kept in state, it would start from 3 s every time
 * and never stop. It is forgotten two minutes after the last try.
 */

export type AutoRetryPhase = "waiting" | "retrying" | "offline" | "stopped";

export interface AutoRetry {
  phase: AutoRetryPhase;
  secondsLeft: number;
  retryNow: () => void;
}

const FORGET_AFTER_MS = 2 * 60_000;
const ANSWER_WITHIN_MS = 20_000;

const tries = new Map<string, { count: number; forget: ReturnType<typeof setTimeout> }>();

function countTry(key: string): void {
  const previous = tries.get(key);
  if (previous) clearTimeout(previous.forget);
  tries.set(key, {
    count: (previous?.count ?? 0) + 1,
    forget: setTimeout(() => tries.delete(key), FORGET_AFTER_MS),
  });
}

/** For tests: every key starts from nothing again. */
export function forgetAllTries(): void {
  for (const { forget } of tries.values()) clearTimeout(forget);
  tries.clear();
}

type Plan = { kind: "waiting"; seconds: number } | { kind: "retrying" } | { kind: "stopped" };

function planFor(key: string, delays: readonly number[]): Plan {
  const seconds = delays[tries.get(key)?.count ?? 0];
  return seconds === undefined ? { kind: "stopped" } : { kind: "waiting", seconds };
}

export function useAutoRetry({
  key,
  failure,
  onRetry,
  delays = AUTO_RETRY_SECONDS,
}: {
  key: string;
  /** Changes with each new failure while on screen. */
  failure: unknown;
  onRetry: () => void;
  delays?: readonly number[];
}): AutoRetry {
  const online = useOnline();
  const [plan, setPlan] = useState<Plan>(() => planFor(key, delays));
  const [armedFor, setArmedFor] = useState(failure);
  if (armedFor !== failure) {
    setArmedFor(failure);
    setPlan(planFor(key, delays));
  }

  const latest = useRef(onRetry);
  useEffect(() => {
    latest.current = onRetry;
  });

  const retryNow = useCallback(() => {
    countTry(key);
    setPlan({ kind: "retrying" });
    latest.current();
  }, [key]);

  useEffect(() => {
    if (plan.kind !== "waiting" || !online) return;
    const timer = setTimeout(() => {
      if (plan.seconds <= 1) retryNow();
      else setPlan({ kind: "waiting", seconds: plan.seconds - 1 });
    }, 1_000);
    return () => clearTimeout(timer);
  }, [plan, online, retryNow]);

  useEffect(() => {
    if (plan.kind !== "retrying") return;
    const timer = setTimeout(() => setPlan(planFor(key, delays)), ANSWER_WITHIN_MS);
    return () => clearTimeout(timer);
  }, [plan, key, delays]);

  useEffect(() => {
    if (plan.kind === "retrying") return;
    return onBackOnline(retryNow);
  }, [plan, retryNow]);

  const phase: AutoRetryPhase =
    plan.kind === "retrying" ? "retrying" : !online ? "offline" : plan.kind === "stopped" ? "stopped" : "waiting";
  return { phase, secondsLeft: plan.kind === "waiting" ? plan.seconds : 0, retryNow };
}
