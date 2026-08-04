import { randomUUID } from 'node:crypto';

import { ZodError } from 'zod';

import { config } from '../../config/index.js';
import { logger, requestContext } from '../../logger.js';
import { AppError } from '../errors.js';

/** Wrap an async handler so a rejected promise reaches Express's error chain. */
export const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

/**
 * Attach a request id and bind it to the async context.
 *
 * Everything logged while handling this request carries the id without anyone
 * threading a parameter through five layers, which is what makes a production
 * incident traceable from a single customer report.
 */
export function requestId(req, res, next) {
  const inbound = String(req.get('x-request-id') ?? '').slice(0, 100);
  req.requestId = inbound || randomUUID();
  req.logContext = { requestId: req.requestId };
  res.set('x-request-id', req.requestId);

  requestContext.run(req.logContext, () => next());
}

/** One structured access-log line per completed request. */
export function accessLog(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level]('http.request', {
      method: req.method,
      // The route pattern, not the path — otherwise every UUID becomes its own
      // log dimension and the aggregator falls over.
      path: req.route?.path ?? req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
    });
  });

  next();
}

/**
 * Per-request deadline.
 *
 * A handler that hangs — a wedged database connection, a provider that never
 * answers — holds a socket, a connection-pool slot, and memory indefinitely.
 * Enough of them and the process stops serving anything, which is a very cheap
 * denial of service.
 *
 * This bounds the *response*, not the work: Node cannot cancel an in-flight
 * query. The point is to free the client and stop the queue growing.
 */
export function requestTimeout(milliseconds = config.requestTimeoutMs) {
  return (req, res, next) => {
    const timer = setTimeout(() => {
      if (res.headersSent) return;

      logger.error('http.request_timeout', {
        method: req.method,
        path: req.route?.path ?? req.path,
        milliseconds,
      });

      res.status(503).json({
        error: {
          code: 'request_timeout',
          message: 'The request took too long and was cancelled. Please try again.',
        },
        requestId: req.requestId,
      });
    }, milliseconds);

    // unref so a pending timer never keeps the process alive during shutdown.
    timer.unref?.();

    const clear = () => clearTimeout(timer);
    res.on('finish', clear);
    res.on('close', clear);

    next();
  };
}

/**
 * Validate against a Zod schema and replace the raw value with the parsed one,
 * so handlers below this layer only ever see clean, correctly typed data.
 */
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      return next(
        new AppError(400, 'validation_failed', 'Request validation failed.', fieldErrors(result.error)),
      );
    }

    // req.query is a getter in newer Express; assign to a parallel property.
    if (source === 'query') req.validatedQuery = result.data;
    else req[source] = result.data;

    return next();
  };
}

function fieldErrors(error) {
  if (!(error instanceof ZodError)) return null;
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'not_found', message: `No route for ${req.method} ${req.path}.` },
    requestId: req.requestId,
  });
}

/**
 * Terminal error handler.
 *
 * Expected failures are reported verbatim. Everything else is a bug: logged
 * with its stack, returned as an opaque 500. Internal messages, stack traces,
 * and database errors never cross the wire.
 */
export function errorHandler(error, req, res, _next) {
  if (error instanceof AppError) {
    return res.status(error.status).json({ error: error.toJSON(), requestId: req.requestId });
  }

  // Body parser rejects malformed JSON before any route runs.
  if (error?.type === 'entity.parse.failed' || error instanceof SyntaxError) {
    return res.status(400).json({
      error: { code: 'invalid_json', message: 'Request body is not valid JSON.' },
      requestId: req.requestId,
    });
  }

  if (error?.type === 'entity.too.large') {
    return res.status(413).json({
      error: { code: 'payload_too_large', message: 'Request body is too large.' },
      requestId: req.requestId,
    });
  }

  // A fail-closed rate limiter could not reach Redis. Rejecting is deliberate:
  // on authentication, unlimited attempts are worse than a brief outage.
  if (error?.code === 'RATE_LIMIT_STORE_UNAVAILABLE') {
    logger.error('ratelimit.fail_closed', { path: req.path });
    res.set('Retry-After', '30');
    return res.status(503).json({
      error: {
        code: 'service_unavailable',
        message: 'Sign-in is temporarily unavailable. Please try again in a moment.',
      },
      requestId: req.requestId,
    });
  }

  logger.error('http.unhandled_error', {
    name: error?.name,
    message: error?.message,
    stack: config.isProduction ? undefined : error?.stack,
    path: req.path,
  });

  return res.status(500).json({
    error: { code: 'internal_error', message: 'Something went wrong on our side.' },
    requestId: req.requestId,
  });
}
