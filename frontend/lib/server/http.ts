import "server-only";

import { randomUUID } from "node:crypto";

import { ApiError, ERROR_CODE, type FieldError } from "@/lib/server/errors";
import { logger } from "@/lib/server/logger";
import { publicFrontendUrl } from "@/lib/server/env";

/**
 * HTTP plumbing shared by every public route handler.
 *
 * A note on CORS: the API and the customer page are served from the same Next
 * application, so the browser makes a same-origin request and never issues a
 * preflight. The CORS problem that blocked the Express backend — `Idempotency-Key`
 * not being in the allowlist, so every mutation failed before it was sent —
 * cannot occur here. The handling below exists only for a non-browser or
 * separate-origin caller, and it echoes exactly one configured origin rather
 * than reflecting whatever asked.
 */

const ALLOWED_REQUEST_HEADERS = "Content-Type, Accept, Idempotency-Key, X-Request-Id";

export function requestIdOf(request: Request): string {
  const inbound = request.headers.get("x-request-id");
  // Bounded and character-checked: this value ends up in logs and in a response
  // header, so an unbounded one is a log-injection and header-splitting vector.
  if (inbound && /^[A-Za-z0-9._-]{1,100}$/.test(inbound)) return inbound;
  return randomUUID();
}

/**
 * Security headers for a JSON API.
 *
 * `default-src 'none'` is the honest CSP for an endpoint that returns no
 * markup: nothing should ever be loaded from a JSON response, so nothing is
 * permitted. `nosniff` is the load-bearing one — without it a browser may
 * re-interpret a response body as a different content type.
 */
function securityHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    // Per-customer and never shared. A cached review context would show one
    // business's page to the next scanner behind the same proxy.
    "Cache-Control": "no-store",
  };

  if (process.env.NODE_ENV === "production") {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload";
  }

  return headers;
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin) return {};

  let allowed: string;
  try {
    allowed = publicFrontendUrl();
  } catch {
    return {};
  }

  if (origin !== allowed) return {};

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": ALLOWED_REQUEST_HEADERS,
    "Access-Control-Expose-Headers": "X-Request-Id",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export function preflight(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: { ...securityHeaders(), ...corsHeaders(request) },
  });
}

function baseHeaders(request: Request, requestId: string): Record<string, string> {
  return { ...securityHeaders(), ...corsHeaders(request), "X-Request-Id": requestId };
}

/**
 * A success body.
 *
 * The raw DTO, with no envelope. The generated client is typed straight from
 * the OpenAPI document, so wrapping it in `{ success, data }` would break every
 * call site at once.
 */
export function json(
  request: Request,
  requestId: string,
  status: number,
  body: unknown,
): Response {
  return Response.json(body, { status, headers: baseHeaders(request, requestId) });
}

export function noContent(request: Request, requestId: string): Response {
  return new Response(null, { status: 204, headers: baseHeaders(request, requestId) });
}

export function errorResponse(request: Request, requestId: string, error: ApiError): Response {
  const body = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
    requestId,
  };

  return Response.json(body, {
    status: error.status,
    headers: { ...baseHeaders(request, requestId), ...(error.headers ?? {}) },
  });
}

/** Body parsing that fails as a validation error rather than an unhandled throw. */
export async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiError(400, ERROR_CODE.validationFailed, "The request could not be accepted.", {
      details: [{ field: "Content-Type", message: "Expected application/json." }],
    });
  }

  // Bounded before parsing. An unbounded body is a trivial memory exhaustion,
  // and nothing this API accepts is anywhere near this size.
  const raw = await request.text();
  if (raw.length > 64 * 1024) {
    throw new ApiError(400, ERROR_CODE.validationFailed, "The request could not be accepted.", {
      details: [{ field: "body", message: "Request body is too large." }],
    });
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ApiError(400, ERROR_CODE.validationFailed, "The request could not be accepted.", {
      details: [{ field: "body", message: "Request body is not valid JSON." }],
    });
  }
}

/**
 * Wraps a handler so no failure reaches the customer as a stack trace.
 *
 * Expected failures are reported verbatim. Everything else is a bug: logged in
 * full server-side, returned as an opaque 500 with the request id, so an
 * engineer can find the line and the customer learns nothing about the
 * internals.
 */
export async function handle(
  request: Request,
  route: string,
  run: (requestId: string) => Promise<Response>,
): Promise<Response> {
  const requestId = requestIdOf(request);
  const startedAt = Date.now();

  try {
    const response = await run(requestId);

    logger.info("public.request", {
      route,
      method: request.method,
      status: response.status,
      durationMs: Date.now() - startedAt,
      requestId,
    });

    return response;
  } catch (error) {
    if (error instanceof ApiError) {
      logger.warn("public.request_rejected", {
        route,
        method: request.method,
        status: error.status,
        code: error.code,
        durationMs: Date.now() - startedAt,
        requestId,
      });
      return errorResponse(request, requestId, error);
    }

    logger.error("public.request_failed", {
      route,
      method: request.method,
      durationMs: Date.now() - startedAt,
      requestId,
      error,
    });

    return errorResponse(
      request,
      requestId,
      new ApiError(500, ERROR_CODE.internalError, "Something went wrong on our side."),
    );
  }
}

export type { FieldError };
