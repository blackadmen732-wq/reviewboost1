import { ApiError } from "./api";

/**
 * When the app steps in after something is slow or fails, and what it says.
 * The same rhythm and the same words as the website
 * (`frontend/lib/recovery/`), so the two never disagree about what happens
 * after a tap that did not work:
 *
 * - A busy button says "Still working…" after 4 s.
 * - A screen that failed to load tries again by itself after 3 s, 10 s and
 *   30 s, counting down, with "Try now"; offline, it waits for the connection.
 * - A change whose answer was lost is checked, not repeated: the app reads
 *   what is true now (within 10 s) and says done, or offers the action again.
 *
 * Nielsen's limits (0.1 s, 1 s, 10 s) and Apple's progress guidance are the
 * reasons; the "When Something Fails" brief has the sources.
 */
export const STILL_WORKING_AFTER_MS = 4_000;
export const AUTO_RETRY_SECONDS = [3, 10, 30] as const;
export const CHECK_BUDGET_MS = 10_000;
export const CHECK_GAPS_MS = [1_000, 2_000, 4_000] as const;
export const RECHECK_SECONDS = [10, 30] as const;

/** No line over twelve words, and none sends the owner off to check. */
export const recoveryWords = {
  retryingIn: (seconds: number) => `Trying again in ${seconds} s.`,
  retryingSoon: "Trying again in a few seconds.",
  retrying: "Trying again…",
  tryNow: "Try now",
  stoppedBody: "Wait a minute, then try again.",
  tryAgain: "Try again",
  offlineTry: "You’re offline. We’ll try again when you’re back.",

  checking: "Checking whether that went through…",
  noAnswerIn: (seconds: number) => `No answer yet. Checking again in ${seconds} s.`,
  noAnswerSoon: "No answer yet. Checking again shortly.",
  checkingAgain: "Checking again…",
  offlineCheck: "You’re offline. We’ll check when you’re back.",
  stillNoAnswer: "Still no answer. Wait a minute, then check again.",
  checkNow: "Check now",
  checkAgain: "Check again",

  stillWorking: "Still working…",

  offlineBanner: "You’re offline. Nothing saves until you’re back.",
  backOnline: "Back online.",
} as const;

export type Outcome = "done" | "not-done" | "unknown";
export type IsDone = (signal: AbortSignal) => Promise<boolean>;

/** A signed-out session is not something to wait out. */
function isFinal(caught: unknown): boolean {
  return caught instanceof ApiError && caught.status === 401;
}

/**
 * A change whose answer was lost may or may not have happened. `isDone`
 * reads what is true now. Reads at once, then after about 1, 2 and 4 s, and
 * answers within 10 s: "done" (a read found it), "not-done" (reads answered,
 * none found it, so trying again does not do it twice) or "unknown" (no read
 * answered: nothing is safe to repeat yet).
 *
 * `serverAnswered`: the change came back with a server error, so the server
 * had finished with it and the first answer is the truth.
 */
export async function checkOutcome(
  isDone: IsDone,
  {
    budgetMs = CHECK_BUDGET_MS,
    gapsMs = CHECK_GAPS_MS,
    random = Math.random,
    serverAnswered = false,
  }: {
    budgetMs?: number;
    gapsMs?: readonly number[];
    random?: () => number;
    serverAnswered?: boolean;
  } = {},
): Promise<Outcome> {
  const deadline = Date.now() + budgetMs;
  let answered = false;
  for (let attempt = 0; ; attempt += 1) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    try {
      if (await readWithin(isDone, left)) return "done";
      if (serverAnswered) return "not-done";
      answered = true;
    } catch (caught) {
      if (isFinal(caught)) throw caught;
    }
    const gap = gapsMs[attempt];
    if (gap === undefined) break;
    const wait = Math.min(Math.round(gap * (0.75 + random() * 0.5)), deadline - Date.now());
    if (wait <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  return answered ? "not-done" : "unknown";
}

async function readWithin(isDone: IsDone, ms: number): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("The check ran out of time."));
    }, ms);
  });
  try {
    return await Promise.race([isDone(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Did the request get an answer from the server? An ApiError with a real
 * status did; a dropped connection or a deadline did not.
 */
export function wasAnswered(caught: unknown): caught is ApiError {
  return caught instanceof ApiError && caught.status > 0;
}

/** A 5xx may have come after the change was kept: check, do not report failure. */
export function isServerError(caught: unknown): boolean {
  return caught instanceof ApiError && caught.status >= 500;
}

/**
 * What a screen says when it could not load: the server's own words when it
 * answered, else a plain "Couldn’t load …". Never a raw "Network request
 * failed": what happens next (a countdown, or waiting for the connection) is
 * said under it by `RetryBlock`.
 */
export function loadFailed(caught: unknown, what: string): string {
  if (wasAnswered(caught) && caught.message) return caught.message;
  return `Couldn’t load ${what}.`;
}
