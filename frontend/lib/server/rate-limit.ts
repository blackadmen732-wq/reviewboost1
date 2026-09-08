import "server-only";

import { ApiError, ERROR_CODE, rateLimited } from "@/lib/server/errors";
import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";

/**
 * Shared, database-backed rate limiter.
 *
 * The store is the only budget every serverless instance shares. If that store
 * is unreachable, or returns an empty/malformed decision, we cannot prove the
 * request is under budget — so we fail closed (503), never open. An empty
 * allow is the same class of hole as a swallowed RPC error.
 */

export interface RateLimitBudget {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

interface RateLimitDecision {
  allowed: boolean;
  retry_after_seconds?: number;
}

function decisionOf(data: unknown): RateLimitDecision | null {
  // Table-returning RPC: only a non-empty array is a real decision. A bare
  // `{ allowed: true }` (or any other object) is malformed — fail closed.
  if (!Array.isArray(data) || data.length === 0) return null;
  const row = data[0];
  if (!row || typeof row !== "object") return null;
  const allowed = (row as { allowed?: unknown }).allowed;
  if (typeof allowed !== "boolean") return null;
  const retry = (row as { retry_after_seconds?: unknown }).retry_after_seconds;
  return {
    allowed,
    ...(typeof retry === "number" && Number.isFinite(retry) ? { retry_after_seconds: retry } : {}),
  };
}

export async function consumeRateLimit(
  budget: RateLimitBudget,
  key: string,
  requestId: string,
): Promise<void> {
  const { data, error } = await serviceRoleClient().rpc("rpc_consume_rate_limit", {
    p_bucket: budget.bucket,
    p_bucket_key: key,
    p_limit: budget.limit,
    p_window_seconds: budget.windowSeconds,
  });

  if (error) {
    logger.warn("rate_limit_unavailable", { bucket: budget.bucket, requestId, error });
    throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
  }

  const decision = decisionOf(data);
  if (!decision) {
    logger.warn("rate_limit_empty_decision", { bucket: budget.bucket, requestId });
    throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
  }

  if (!decision.allowed) {
    logger.warn("rate_limited", { bucket: budget.bucket, requestId });
    throw rateLimited(decision.retry_after_seconds ?? 60);
  }
}
