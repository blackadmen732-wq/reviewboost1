import type { ErrorResponse } from "@/lib/api/customer-flow-types";

export class CustomerApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;

  constructor({
    message,
    status,
    code,
    requestId,
    cause,
  }: {
    message: string;
    status: number;
    code: string;
    requestId?: string;
    cause?: unknown;
  }) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CustomerApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export function isUnavailableReviewLink(error: unknown): boolean {
  return error instanceof CustomerApiError && error.status === 404;
}

export function toCustomerApiError(response: Response, payload: unknown): CustomerApiError {
  const parsed = payload as Partial<ErrorResponse> | undefined;
  const code = parsed?.error?.code ?? `http_${response.status}`;
  const message = parsed?.error?.message ?? "The request could not be completed.";
  const requestId = parsed?.requestId;

  return new CustomerApiError({
    status: response.status,
    code,
    message,
    ...(requestId ? { requestId } : {}),
  });
}

export function networkCustomerApiError(cause: unknown): CustomerApiError {
  return new CustomerApiError({
    status: 0,
    code: "network_error",
    message: "The network request failed.",
    cause,
  });
}
