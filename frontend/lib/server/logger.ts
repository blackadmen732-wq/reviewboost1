import "server-only";

/**
 * Structured logging.
 *
 * One JSON object per line, always carrying the request id, so a single
 * customer report can be traced through every layer that touched it.
 *
 * Redaction is recursive and key-based rather than value-based, because the
 * realistic leak is not someone writing `log(password)` — it is a nested
 * provider error object echoing a token, a note, or a key back inside a field
 * nobody inspected before logging the whole thing.
 */

type Level = "debug" | "info" | "warn" | "error";

const REDACTED = "[redacted]";

/**
 * Keys whose values never appear in a log line, at any depth.
 *
 * Customer content is here for the same reason secrets are: a private note is
 * the customer's, not ours, and it has no business in an operational log.
 */
const SENSITIVE_KEYS = new Set([
  "token",
  "sessionid",
  "responseid",
  "sessiontoken",
  "responsetoken",
  "idempotencykey",
  "note",
  "firstname",
  "praisenote",
  "password",
  "authorization",
  "cookie",
  "apikey",
  "servicerolekey",
  "supabaseservicerolekey",
  "encryptionkey",
  "secret",
  "accesstoken",
  "refreshtoken",
  "email",
  "phone",
  "ip",
  "ipaddress",
]);

function isSensitive(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase().replace(/[_-]/g, ""));
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((entry) => redact(entry, depth + 1));

  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = isSensitive(key) ? REDACTED : redact(entry, depth + 1);
    }
    return result;
  }

  return value;
}

function emit(level: Level, event: string, context: Record<string, unknown>): void {
  const line = JSON.stringify({
    level,
    event,
    at: new Date().toISOString(),
    ...(redact(context) as Record<string, unknown>),
  });

   
  if (level === "error") console.error(line);
   
  else if (level === "warn") console.warn(line);
   
  else console.log(line);
}

export const logger = {
  debug: (event: string, context: Record<string, unknown> = {}) => emit("debug", event, context),
  info: (event: string, context: Record<string, unknown> = {}) => emit("info", event, context),
  warn: (event: string, context: Record<string, unknown> = {}) => emit("warn", event, context),
  error: (event: string, context: Record<string, unknown> = {}) => emit("error", event, context),
};

/** Exported for the test that proves redaction actually holds. */
export const __redactForTests = redact;
