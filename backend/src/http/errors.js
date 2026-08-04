/**
 * One error shape for the entire API.
 *
 * Every failure response is `{ error: { code, message, details? }, requestId }`.
 *
 * The distinction that matters is *expected* versus *bug*. An AppError is a
 * condition the code anticipated — bad input, missing permission, lapsed
 * subscription — and its message is written for the caller to read. Anything
 * else is a defect: it gets logged with its stack and reported as a generic
 * 500, so internals never cross the wire.
 */

export class AppError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    // Stable, machine-readable. Clients branch on this, never on the message.
    this.code = code;
    this.details = details;
    this.expected = true;
  }

  toJSON() {
    return { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
  }
}

export const badRequest = (code, message, details) => new AppError(400, code, message, details);

export const unauthorized = (code = 'unauthorized', message = 'Authentication is required.') =>
  new AppError(401, code, message);

/** 402 — the request is valid and the caller is who they say; they just have not paid. */
export const paymentRequired = (code, message) => new AppError(402, code, message);

export const forbidden = (code = 'forbidden', message = 'You do not have permission to do that.') =>
  new AppError(403, code, message);

export const notFound = (code = 'not_found', message = 'Resource not found.') =>
  new AppError(404, code, message);

export const conflict = (code, message) => new AppError(409, code, message);

/** 423 — correct credentials would still be refused right now. Distinct from 401. */
export const locked = (code, message) => new AppError(423, code, message);

export const tooManyRequests = (code = 'rate_limited', message = 'Too many requests.') =>
  new AppError(429, code, message);

export const serviceUnavailable = (code, message) => new AppError(503, code, message);
