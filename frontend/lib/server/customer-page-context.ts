import "server-only";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { cache } from "react";

import type { CustomerReviewContext } from "@/lib/api/customer-flow-types";
import { shouldUseCustomerFixtures } from "@/lib/api/fixture-flags";
import { getContext } from "@/lib/server/customer-flow-service";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { logger } from "@/lib/server/logger";
import { requestMetaFromHeaders } from "@/lib/server/request-meta";
import { parseTokenOrThrow } from "@/lib/server/validation";

export type ServerCustomerContext =
  | { kind: "ready"; context: CustomerReviewContext }
  | { kind: "unavailable" }
  /** Anything else (database briefly down, rate limited): the browser retries as before. */
  | null;

/**
 * The customer page's context, read while the HTML is rendered.
 *
 * Before, the page arrived empty, waited for its JavaScript, then asked the
 * API for the same data: three trips before the stars showed. Reading it here
 * puts the business name, photo, question and stars in the first response.
 *
 * It is the same `getContext` the API serves — same rate limit, same token
 * rules, records nothing — so a crawler or a refresh still cannot count as a
 * scan. `cache` makes the page and its metadata share one read.
 */
export const loadCustomerPageContext = cache(async (token: string): Promise<ServerCustomerContext> => {
  // Development fixtures are client-side; the server has nothing to read.
  if (shouldUseCustomerFixtures()) return null;

  let validToken: string;
  try {
    validToken = parseTokenOrThrow(token);
  } catch {
    return { kind: "unavailable" };
  }

  const requestId = randomUUID();
  try {
    const meta = requestMetaFromHeaders(await headers(), requestId);
    return { kind: "ready", context: await getContext(validToken, meta) };
  } catch (error) {
    if (error instanceof ApiError && error.code === ERROR_CODE.reviewLinkInactive) {
      return { kind: "unavailable" };
    }
    logger.warn("customer_page.server_context_failed", {
      requestId,
      code: error instanceof ApiError ? error.code : "unexpected",
    });
    return null;
  }
});
