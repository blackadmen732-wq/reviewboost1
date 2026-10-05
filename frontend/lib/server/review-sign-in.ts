import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { keyedDigest } from "@/lib/server/crypto";
import { tokenDigestKey } from "@/lib/server/env";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";

/**
 * App Review's way in.
 *
 * WHY THIS EXISTS
 * ---------------
 * ReviewBoost has no passwords: signing in means typing a six-digit code that
 * arrives by email. Apple's reviewers cannot read our mailbox, and Guideline
 * 2.1(a) requires a working demo account for an app with a login. So one
 * configured address can sign in with one configured code instead of an
 * emailed one — on the same screen, through the same session machinery.
 *
 * WHAT KEEPS IT SAFE
 * ------------------
 * - Off unless both REVIEW_SIGN_IN_EMAIL and REVIEW_SIGN_IN_CODE are set on the
 *   server. Nothing about it is in the app binary. Unset, the route is a 404.
 * - Exactly one account. The address is the server's, never the caller's
 *   choice; a request naming any other address fails the same way a wrong code
 *   does, so the route does not reveal which address is the reviewer's.
 * - Constant-time comparison of fixed-length digests.
 * - Rate limited per client (a daily-rotating keyed digest of the address,
 *   never the address itself) and across all clients, and refused outright if
 *   the limiter cannot answer. Six digits are one in a million; at these
 *   budgets guessing takes years.
 * - It mints nothing permanent: it returns a one-time Supabase token hash that
 *   the app exchanges for an ordinary session, exactly as an emailed code would.
 *
 * The reviewer account should own a demo business with fictional data only,
 * and the code should be rotated after each review.
 */

export const REVIEW_CODE_PATTERN = /^\d{6}$/;

interface Budget {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

/** One client: a handful of tries, then a pause. */
const PER_CLIENT: Budget = { bucket: "review-sign-in-client", limit: 5, windowSeconds: 15 * 60 };
/** Everyone together: enough for a review team, far too few to guess with. */
const OVERALL: Budget = { bucket: "review-sign-in-all", limit: 200, windowSeconds: 24 * 60 * 60 };

export interface ReviewSignInConfig {
  email: string;
  code: string;
}

/** The configured account, or null when the feature is off or misconfigured. */
export function reviewSignInConfig(env: NodeJS.ProcessEnv = process.env): ReviewSignInConfig | null {
  const email = env["REVIEW_SIGN_IN_EMAIL"]?.trim().toLowerCase();
  const code = env["REVIEW_SIGN_IN_CODE"]?.trim();
  if (!email && !code) return null;
  if (!email || !email.includes("@") || !code || !REVIEW_CODE_PATTERN.test(code)) {
    // Half-configured is treated as off, loudly, rather than as a code anyone
    // could satisfy.
    logger.warn("review_sign_in.misconfigured", {
      hasEmail: Boolean(email),
      codeLooksValid: Boolean(code && REVIEW_CODE_PATTERN.test(code)),
    });
    return null;
  }
  return { email, code };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Both the address and the code must match; compared without early exit. */
export function matchesReviewAccount(
  config: ReviewSignInConfig,
  email: string,
  code: string,
): boolean {
  const emailOk = timingSafeEqual(digest(config.email), digest(email.trim().toLowerCase()));
  const codeOk = timingSafeEqual(digest(config.code), digest(code.trim()));
  return emailOk && codeOk;
}

function rateLimited(): ApiError {
  return new ApiError(
    429,
    ERROR_CODE.rateLimited,
    "Too many attempts. Wait a few minutes and try again.",
    { headers: { "Retry-After": "900" } },
  );
}

async function consume(budget: Budget, key: string, requestId: string): Promise<void> {
  const { data, error } = await serviceRoleClient().rpc("rpc_consume_rate_limit", {
    p_bucket: budget.bucket,
    p_bucket_key: key,
    p_limit: budget.limit,
    p_window_seconds: budget.windowSeconds,
  });
  const row = Array.isArray(data) ? (data[0] as { allowed?: boolean } | undefined) : undefined;
  // A limiter that cannot answer is a refusal here: this route exists to hand
  // out a session.
  if (error || !row) {
    logger.warn("review_sign_in.rate_limit_unavailable", { bucket: budget.bucket, requestId, error });
    throw rateLimited();
  }
  if (!row.allowed) throw rateLimited();
}

export async function reviewSignIn(
  config: ReviewSignInConfig,
  input: { email: string; code: string },
  address: string | null,
  requestId: string,
): Promise<{ tokenHash: string }> {
  const day = new Date().toISOString().slice(0, 10);
  const client = keyedDigest(`${day}|${address ?? "unknown"}`, "review_sign_in", tokenDigestKey());

  await consume(PER_CLIENT, client, requestId);

  // The mobile app asks this endpoint after every rejected emailed code, for
  // every user, so most requests are ordinary people's typos. Those must not
  // spend the shared daily budget the App Review account depends on: only an
  // attempt on the review address does. A wrong address is answered exactly
  // like a wrong code.
  if (!timingSafeEqual(digest(config.email), digest(input.email.trim().toLowerCase()))) {
    logger.info("review_sign_in.rejected", { requestId });
    throw new ApiError(401, ERROR_CODE.sessionInvalid, "That code is not right.");
  }

  await consume(OVERALL, "all", requestId);

  if (!matchesReviewAccount(config, input.email, input.code)) {
    logger.info("review_sign_in.rejected", { requestId });
    throw new ApiError(401, ERROR_CODE.sessionInvalid, "That code is not right.");
  }

  const { data, error } = await serviceRoleClient().auth.admin.generateLink({
    type: "magiclink",
    email: config.email,
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    logger.error("review_sign_in.link_failed", { requestId, error: error?.message });
    throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Sign-in is unavailable. Try again shortly.");
  }

  logger.info("review_sign_in.accepted", { requestId });
  return { tokenHash };
}
