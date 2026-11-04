"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AUTO_RETRY_SECONDS } from "@/lib/recovery/timing";
import { useOnline } from "@/lib/recovery/use-online";

/**
 * Something that failed to load tries again by itself: after 3 s, then 10 s,
 * then 30 s, counting down, with "Try now" to skip the wait. Then it stops
 * and says so, and "Try again" is the owner's. Offline it does not count
 * down: it waits for the connection and tries the moment it is back.
 *
 * The number of tries is kept outside the component, under `key`, because an
 * error page can be a new component after each failed try. Kept in state, it
 * would start again from 3 s every time and never stop. It is forgotten two
 * minutes after the last try, so a failure much later starts from 3 s again.
 */

export type AutoRetryPhase = "waiting" | "retrying" | "offline" | "stopped";

export interface AutoRetry {
  phase: AutoRetryPhase;
  /** Whole seconds until the next try, while waiting. */
  secondsLeft: number;
  /** Try at once. Counts as one of the tries. */
  retryNow: () => void;
}

const FORGET_AFTER_MS = 2 * 60_000;
/** A try that has not answered by now counts as failed. */
const ANSWER_WITHIN_MS = 20_000;

const tries = new Map<
  string,
  { count: number; forget: ReturnType<typeof setTimeout> }
>();

function triesSoFar(key: string, startAt: number): number {
  return tries.get(key)?.count ?? startAt;
}

function countTry(key: string, startAt: number): void {
  const previous = tries.get(key);
  if (previous) clearTimeout(previous.forget);
  tries.set(key, {
    count: (previous?.count ?? startAt) + 1,
    forget: setTimeout(() => tries.delete(key), FORGET_AFTER_MS),
  });
}

/** For tests: every key starts from nothing again. */
export function forgetAllTries(): void {
  for (const { forget } of tries.values()) clearTimeout(forget);
  tries.clear();
}

type Plan =
  | { kind: "waiting"; seconds: number }
  | { kind: "retrying" }
  | { kind: "stopped" };

function planFor(key: string, delays: readonly number[], startAt: number): Plan {
  const seconds = delays[triesSoFar(key, startAt)];
  return seconds === undefined
    ? { kind: "stopped" }
    : { kind: "waiting", seconds };
}

export function useAutoRetry({
  key,
  failure,
  onRetry,
  delays = AUTO_RETRY_SECONDS,
  startAt = 0,
}: {
  /** What failed, so the count survives the component being remade. */
  key: string;
  /** Changes with each new failure: the try before it did not work. */
  failure: unknown;
  onRetry: () => void;
  /** A constant, not a new array each render. */
  delays?: readonly number[];
  /** Tries already made where memory does not reach (a page that reloads). */
  startAt?: number;
}): AutoRetry {
  const online = useOnline();
  const [plan, setPlan] = useState<Plan>(() => planFor(key, delays, startAt));
  const [armedFor, setArmedFor] = useState(failure);
  if (armedFor !== failure) {
    // A new failure while still on screen: the last try did not work.
    setArmedFor(failure);
    setPlan(planFor(key, delays, startAt));
  }

  const latest = useRef(onRetry);
  useEffect(() => {
    latest.current = onRetry;
  });

  const retryNow = useCallback(() => {
    countTry(key, startAt);
    setPlan({ kind: "retrying" });
    latest.current();
  }, [key, startAt]);

  // One second at a time. Not while offline: the `online` event tries then.
  useEffect(() => {
    if (plan.kind !== "waiting" || !online) return;
    const timer = setTimeout(() => {
      if (plan.seconds <= 1) retryNow();
      else setPlan({ kind: "waiting", seconds: plan.seconds - 1 });
    }, 1_000);
    return () => clearTimeout(timer);
  }, [plan, online, retryNow]);

  // Never stuck on "Trying again…": a try with no answer counts as failed.
  useEffect(() => {
    if (plan.kind !== "retrying") return;
    const timer = setTimeout(
      () => setPlan(planFor(key, delays, startAt)),
      ANSWER_WITHIN_MS,
    );
    return () => clearTimeout(timer);
  }, [plan, key, delays, startAt]);

  // Back online: try at once rather than wait out a countdown.
  useEffect(() => {
    if (plan.kind === "retrying") return;
    window.addEventListener("online", retryNow);
    return () => window.removeEventListener("online", retryNow);
  }, [plan, retryNow]);

  const phase: AutoRetryPhase =
    plan.kind === "retrying"
      ? "retrying"
      : !online
        ? "offline"
        : plan.kind === "stopped"
          ? "stopped"
          : "waiting";
  return {
    phase,
    secondsLeft: plan.kind === "waiting" ? plan.seconds : 0,
    retryNow,
  };
}
