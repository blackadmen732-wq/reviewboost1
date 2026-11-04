/**
 * What a request for an emailed sign-in code, or a typed code, came to.
 *
 * Supabase refuses a second code to the same address within a minute, and caps
 * how many it sends an hour, both with a 429. Treating that like any other
 * failure left the person on the email step with no way to type the code that
 * may already be in their inbox — and left App Review, whose code is not
 * emailed at all, with no way to reach the code field if two reviewers tried
 * within a minute. A throttled request therefore still moves on to the code
 * step, saying what happened instead of claiming a new code was sent.
 *
 * A request that got no answer at all is the phone, not the address and not
 * the code: it says so, and a typed code is kept, because it still works.
 */
export type SendCodeResult =
  | { kind: "sent" }
  | { kind: "throttled"; message: string }
  | { kind: "failed"; message: string };

export type VerifyCodeResult =
  | { kind: "signed-in" }
  /** The code itself was refused: it is cleared, to be typed again. */
  | { kind: "wrong"; message: string }
  /** Nothing was decided about the code: it is kept, to try again. */
  | { kind: "retry"; message: string };

export const THROTTLED_MESSAGE =
  "We can’t send another code just yet. If one arrived in the last few minutes, use it, or send a new one in a minute.";

export const FAILED_MESSAGE = "We could not send the code. Check the address and try again.";

// The offline bar above already says "You’re offline": these say what
// happened to the code and what to do next, not the same thing twice.
export const OFFLINE_SEND_MESSAGE = "No code was sent. Tap Continue once you’re back online.";
export const SLOW_SEND_MESSAGE = "Sending the code is taking too long. Try again.";
export const NOT_ANSWERING_MESSAGE = "ReviewBoost isn’t answering. Try again in a minute.";

export const WRONG_CODE_MESSAGE = "That code didn’t work. Use the newest code we sent.";
export const OFFLINE_CODE_MESSAGE = "Your code still works. Tap Sign in once you’re back online.";
export const SLOW_CODE_MESSAGE = "Signing in is taking too long. Your code still works.";
export const CODE_NOT_ANSWERING_MESSAGE = "ReviewBoost isn’t answering. Your code still works.";
export const TOO_MANY_TRIES_MESSAGE = "Too many tries. Wait a minute, then try again.";

export const EMAIL_INCOMPLETE_MESSAGE = "Check the email address.";

/** How Supabase Auth reports a failure: its error's name and HTTP status. */
export interface AuthFailure {
  name?: string;
  status?: number;
}

/**
 * No answer at all: Supabase Auth wraps a fetch that threw (a dropped
 * connection, airplane mode) as AuthRetryableFetchError with status 0.
 */
export function authUnreachable(error: AuthFailure | null): boolean {
  return error?.name === "AuthRetryableFetchError" && (error.status ?? 0) === 0;
}

/** Answered, but by a server that is down: a 5xx, retryable or not. */
function authNotAnswering(error: AuthFailure): boolean {
  return (error.status ?? 0) >= 500;
}

export function sendCodeResult(error: AuthFailure | null): SendCodeResult {
  if (!error) return { kind: "sent" };
  if (error.status === 429) return { kind: "throttled", message: THROTTLED_MESSAGE };
  if (authUnreachable(error)) return { kind: "failed", message: OFFLINE_SEND_MESSAGE };
  if (authNotAnswering(error)) return { kind: "failed", message: NOT_ANSWERING_MESSAGE };
  return { kind: "failed", message: FAILED_MESSAGE };
}

/**
 * A typed code that Supabase did not accept. Only a refusal from the server
 * means the code is wrong (or old: a newer code replaces it). Offline, slow or
 * down, the code is still good, and clearing it would make the person type it
 * again for nothing.
 */
export function verifyCodeResult(error: AuthFailure | null): VerifyCodeResult {
  if (!error) return { kind: "signed-in" };
  if (authUnreachable(error)) return { kind: "retry", message: OFFLINE_CODE_MESSAGE };
  if (error.status === 429) return { kind: "retry", message: TOO_MANY_TRIES_MESSAGE };
  if (authNotAnswering(error)) return { kind: "retry", message: CODE_NOT_ANSWERING_MESSAGE };
  return { kind: "wrong", message: WRONG_CODE_MESSAGE };
}

/**
 * An address a code can reach: something before the @, and a domain with a
 * dot in it ("example.com", not "example"). Not a full RFC check: only the
 * mistakes a thumb makes, caught before a code goes nowhere.
 */
export function isCompleteEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/.test(value.trim());
}
