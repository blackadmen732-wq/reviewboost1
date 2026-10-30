/**
 * What a request for an emailed sign-in code came to.
 *
 * Supabase refuses a second code to the same address within a minute, and caps
 * how many it sends an hour, both with a 429. Treating that like any other
 * failure left the person on the email step with no way to type the code that
 * may already be in their inbox — and left App Review, whose code is not
 * emailed at all, with no way to reach the code field if two reviewers tried
 * within a minute. A throttled request therefore still moves on to the code
 * step, saying what happened instead of claiming a new code was sent.
 */
export type SendCodeResult =
  | { kind: "sent" }
  | { kind: "throttled"; message: string }
  | { kind: "failed"; message: string };

export const THROTTLED_MESSAGE =
  "We can’t send another code just yet. If one arrived in the last few minutes, use it, or send a new one in a minute.";

export const FAILED_MESSAGE = "We could not send the code. Check the address and try again.";

export function sendCodeResult(error: { status?: number } | null): SendCodeResult {
  if (!error) return { kind: "sent" };
  if (error.status === 429) return { kind: "throttled", message: THROTTLED_MESSAGE };
  return { kind: "failed", message: FAILED_MESSAGE };
}
