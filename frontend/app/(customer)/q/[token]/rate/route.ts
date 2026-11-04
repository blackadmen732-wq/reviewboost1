import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import {
  createSession,
  getContext,
  recordDestinationSelection,
  submitResponse,
} from "@/lib/server/customer-flow-service";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { logger } from "@/lib/server/logger";
import { requestMetaOf } from "@/lib/server/request-meta";
import {
  DEFAULT_LOCALE,
  idempotencyKeySchema,
  parseTokenOrThrow,
  SUPPORTED_LOCALES,
} from "@/lib/server/validation";
import { requireValidatedDestination } from "@/lib/security/destination";

/**
 * POST /q/{token}/rate — a star tapped before the page's JavaScript loaded.
 *
 * The same three writes the browser flow makes (session, rating, handoff),
 * through the same service, rate limits and idempotency, done here in one trip
 * from the phone; then 303 to the business's review page. Every rating, one to
 * five, takes exactly this path to exactly the same destination.
 *
 * - The rating must be saved before the customer leaves. If it is not, they
 *   come back to the page with their star still chosen and a Try again.
 * - The handoff record is not: a tracking write never stands between a
 *   customer and the review page (the same rule as the browser flow).
 * - The key comes from the page and is the same for a double tap or a resent
 *   form, so one page view is never two ratings.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function backToPage(request: NextRequest, token: string, rating: number | null): NextResponse {
  const url = new URL(`/q/${encodeURIComponent(token)}`, request.url);
  if (rating !== null) {
    url.searchParams.set("retry", "1");
    url.searchParams.set("rating", String(rating));
  }
  return NextResponse.redirect(url, 303);
}

function formString(form: FormData | null, name: string): string {
  const value = form?.get(name);
  return typeof value === "string" ? value : "";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const requestId = randomUUID();

  let validToken: string;
  try {
    validToken = parseTokenOrThrow(token);
  } catch {
    // The page itself shows the neutral "not active" screen.
    return backToPage(request, token, null);
  }

  const form = await request.formData().catch(() => null);
  const rating = Number(formString(form, "visit-rating"));
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return backToPage(request, token, null);

  const localeValue = formString(form, "locale");
  const locale = (SUPPORTED_LOCALES as readonly string[]).includes(localeValue)
    ? (localeValue as (typeof SUPPORTED_LOCALES)[number])
    : DEFAULT_LOCALE;

  const key = idempotencyKeySchema.safeParse(formString(form, "key"));
  if (!key.success) return backToPage(request, token, rating);

  const meta = requestMetaOf(request, requestId);
  let destinationUrl: string;
  let sessionId: string;
  let responseId: string;
  try {
    const context = await getContext(validToken, meta);
    destinationUrl = requireValidatedDestination(context.destination).url;
    const session = await createSession(validToken, { locale, idempotencyKey: `${key.data}.session` }, meta);
    sessionId = session.body.sessionId;
    const response = await submitResponse(
      validToken,
      { sessionId, rating, idempotencyKey: `${key.data}.response` },
      meta,
    );
    responseId = response.body.responseId;
  } catch (error) {
    if (error instanceof ApiError && error.code === ERROR_CODE.reviewLinkInactive) {
      return backToPage(request, token, null);
    }
    logger.warn("customer_page.early_rating_failed", {
      requestId,
      code: error instanceof ApiError ? error.code : "unexpected",
    });
    return backToPage(request, token, rating);
  }

  try {
    await recordDestinationSelection(
      validToken,
      { sessionId, responseId, idempotencyKey: `${key.data}.destination` },
      meta,
    );
  } catch (error) {
    // Deliberately not fatal: see above.
    logger.warn("customer_page.early_handoff_record_failed", {
      requestId,
      code: error instanceof ApiError ? error.code : "unexpected",
    });
  }

  return NextResponse.redirect(destinationUrl, 303);
}
