import { AsyncLocalStorage } from 'node:async_hooks';

import { config } from './config/index.js';

/**
 * Structured logging.
 *
 * One JSON object per line, so logs are queryable in any aggregator without a
 * parsing rule. Two properties matter more than the format:
 *
 *   Correlation — a request id flows through async call stacks via
 *   AsyncLocalStorage, so every line emitted while handling a request carries
 *   it without anyone threading a parameter through five layers.
 *
 *   Redaction — this product handles phone numbers, message bodies, and
 *   credentials. Redaction is recursive and applied to every field, because the
 *   realistic leak is not someone logging `password` deliberately; it is a
 *   nested Twilio or Stripe error object that happens to echo the recipient
 *   back inside it.
 */

const LEVELS = { silent: 100, error: 50, warn: 40, info: 30, debug: 20 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

export const requestContext = new AsyncLocalStorage();

/** Values under these keys never reach a log line, at any nesting depth. */
const REDACTED_KEYS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'newpassword',
  'currentpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'challengetoken',
  'csrftoken',
  'authorization',
  'cookie',
  'secret',
  'apikey',
  'authtoken',
  'phone',
  'phonenumber',
  'to',
  'from',
  'email',
  'body',
  'messagebody',
  'feedbacktext',
  'code',
  'recoverycodes',
]);

const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 20;
const MAX_STRING_LENGTH = 2000;

function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return '[truncated]';

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  }
  if (typeof value !== 'object') return value;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      // Stacks contain absolute paths; useful locally, noise and a mild
      // disclosure risk in production.
      ...(config.isProduction ? {} : { stack: value.stack }),
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => redact(item, depth + 1));
  }

  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(nested, depth + 1);
  }
  return output;
}

function emit(level, event, details) {
  if (LEVELS[level] < threshold) return;

  const store = requestContext.getStore();
  const line = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(store?.requestId ? { requestId: store.requestId } : {}),
    ...(store?.accountId ? { accountId: store.accountId } : {}),
    ...(store?.userId ? { userId: store.userId } : {}),
    ...(details ? redact(details) : {}),
  };

  let serialized;
  try {
    serialized = JSON.stringify(line);
  } catch {
    // A circular reference must not take down the process that was trying to
    // report a problem.
    serialized = JSON.stringify({
      timestamp: line.timestamp,
      level,
      event,
      note: 'log payload was not serialisable',
    });
  }

  // Errors and warnings to stderr so they survive a stdout redirect.
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${serialized}\n`);
}

export const logger = {
  error: (event, details) => emit('error', event, details),
  warn: (event, details) => emit('warn', event, details),
  info: (event, details) => emit('info', event, details),
  debug: (event, details) => emit('debug', event, details),
};

/** Exposed for tests that need to assert redaction behaviour directly. */
export const __testing = { redact };
