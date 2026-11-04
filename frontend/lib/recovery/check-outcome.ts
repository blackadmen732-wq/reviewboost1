import { SessionExpiredError } from "@/lib/api/owner-fetch";
import { CHECK_BUDGET_MS, CHECK_GAPS_MS } from "@/lib/recovery/timing";

/**
 * A change whose answer was lost (the connection dropped, or it ran past its
 * deadline) may or may not have happened. Instead of asking the owner to go
 * and look, ask the server: `isDone` reads what is true now and says whether
 * the change is there.
 *
 * It reads at once, then after about 1, 2 and 4 seconds, and answers within
 * 10 seconds:
 * - "done": a read found the change.
 * - "not-done": reads answered and none found it, across the whole time. The
 *   server had those seconds to finish, so trying again does not do it twice.
 * - "unknown": no read answered. Nothing is safe to repeat yet.
 *
 * `serverAnswered`: the change came back with a server error, so the server
 * had finished with it; the first read that answers is the truth, and there
 * is nothing to wait out. A lost answer (no response at all) is different:
 * the server may still be working, so the reads go on for the whole time.
 *
 * An expired session is not something to wait out, so it is thrown.
 */
export type Outcome = "done" | "not-done" | "unknown";

export type IsDone = (signal: AbortSignal) => Promise<boolean>;

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
    /** A quarter either way on each gap, so many phones do not read in step. */
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
      if (caught instanceof SessionExpiredError) throw caught;
    }
    const gap = gapsMs[attempt];
    if (gap === undefined) break;
    const wait = Math.min(
      Math.round(gap * (0.75 + random() * 0.5)),
      deadline - Date.now(),
    );
    if (wait <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  return answered ? "not-done" : "unknown";
}

/** One read, given up on (and its request cancelled) when the time is gone. */
async function readWithin(isDone: IsDone, ms: number): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const reason = new DOMException("The check ran out of time.", "TimeoutError");
      controller.abort(reason);
      reject(reason);
    }, ms);
  });
  try {
    return await Promise.race([isDone(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A server error is not an answer about the change: it may have come after
 * the change was kept. Callers check instead of reporting failure.
 */
export function isServerError(response: { status: number }): boolean {
  return response.status >= 500;
}
