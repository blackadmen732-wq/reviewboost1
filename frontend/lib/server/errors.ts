import "server-only";

/**
 * The one error shape the public API ever returns.
 *
 *   { error: { code, message, details? }, requestId }
 *
 * `code` is the contract. Clients branch on it and never on `message`, so the
 * wording can change without breaking anyone.
 *
 * The distinction that matters is *expected* versus *bug*. An ApiError is a
 * condition the code anticipated, and its message is written for a customer to
 * read. Anything else is a defect: it is logged with its stack and reported as
 * an opaque 500, so no stack trace, SQL text, Supabase message, table name, or
 * secret ever crosses the wire.
 */

export const ERROR_CODE = {
  validationFailed: "validation_failed",
  reviewLinkInactive: "review_link_inactive",
  sessionInvalid: "session_invalid",
  sessionExpired: "session_expired",
  responseConflict: "response_conflict",
  idempotencyConflict: "idempotency_conflict",
  idempotencyInProgress: "idempotency_in_progress",
  rateLimited: "rate_limited",
  // Owner-side only. Covers "does not exist" and "belongs to another business"
  // with one indistinguishable answer, because RLS returns no row for either and
  // telling them apart would confirm that another tenant's record exists.
  notFound: "not_found",
  // The caller is legitimately signed in and in the right business, but lacks
  // the role. Distinct from notFound on purpose: hiding a real permission
  // boundary behind "missing" leaves someone retrying a thing that will never
  // work.
  forbidden: "forbidden",
  organizationSelectionRequired: "organization_selection_required",
  requestTimeout: "request_timeout",
  internalError: "internal_error",
  serviceUnavailable: "service_unavailable",
} as const;

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];

export interface FieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: FieldError[] | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    options?: { details?: FieldError[]; headers?: Record<string, string> },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = options?.details;
    this.headers = options?.headers;
  }
}

/**
 * Unknown, paused, retired, and not-yet-configured stands all return this.
 *
 * Identical status, code, and message. Distinguishing them would confirm to
 * anyone holding a guessed token that the token was once real, and would leak
 * whether a particular business is a customer.
 */
export function reviewLinkInactive(): ApiError {
  return new ApiError(404, ERROR_CODE.reviewLinkInactive, "This review link is not active.");
}

export function validationFailed(details: FieldError[]): ApiError {
  return new ApiError(400, ERROR_CODE.validationFailed, "The request could not be accepted.", {
    details,
  });
}

export function rateLimited(retryAfterSeconds: number): ApiError {
  return new ApiError(429, ERROR_CODE.rateLimited, "Too many requests. Please try again shortly.", {
    headers: { "Retry-After": String(retryAfterSeconds) },
  });
}
