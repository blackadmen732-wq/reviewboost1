import "server-only";

/**
 * Server-only configuration.
 *
 * Read lazily rather than at module load, so `next build` does not need
 * production secrets present to compile. Every accessor throws on first use if
 * its value is missing or malformed — a request that cannot be served correctly
 * fails loudly instead of quietly doing the wrong thing.
 *
 * Nothing here is ever exported to the client. The `server-only` import above
 * turns an accidental import from a client component into a build error rather
 * than a leaked key.
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function read(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new ConfigError(`${name} is required.`);
  }
  return value.trim();
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * The origin printed into every QR code and written to every NFC tag.
 *
 * Validated rather than trusted, and required in production. A stand is a
 * physical object: a code printed against the wrong origin is already sitting
 * on a customer's table and cannot be recalled, so silently falling back to
 * localhost in production is not an acceptable failure mode.
 */
export function publicFrontendUrl(): string {
  const raw = process.env.PUBLIC_FRONTEND_URL?.trim();

  if (!raw) {
    if (isProduction()) {
      throw new ConfigError(
        "PUBLIC_FRONTEND_URL is required in production. It is the origin printed into " +
          "every QR code, and a stand printed against the wrong origin cannot be recalled.",
      );
    }
    return "http://localhost:3000";
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigError("PUBLIC_FRONTEND_URL must be an absolute URL, e.g. https://app.example.com");
  }

  if (parsed.protocol !== "https:" && isProduction()) {
    throw new ConfigError("PUBLIC_FRONTEND_URL must use HTTPS in production.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ConfigError("PUBLIC_FRONTEND_URL must use HTTP or HTTPS.");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new ConfigError("PUBLIC_FRONTEND_URL must be scheme://host[:port] only.");
  }

  return parsed.origin;
}

export function supabaseUrl(): string {
  return read("SUPABASE_URL");
}

/**
 * The service-role key bypasses Row Level Security entirely.
 *
 * It is read here and nowhere else, it is never logged, and it must never be
 * named `NEXT_PUBLIC_*` — that prefix is what decides whether Next inlines a
 * value into the browser bundle, so the naming *is* the security boundary.
 */
export function supabaseServiceRoleKey(): string {
  const key = read("SUPABASE_SERVICE_ROLE_KEY");

  if (process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY) {
    throw new ConfigError(
      "SUPABASE_SERVICE_ROLE_KEY must never be exposed as NEXT_PUBLIC_*. That prefix " +
        "inlines the value into the browser bundle, which would hand every visitor a key " +
        "that bypasses row level security.",
    );
  }

  return key;
}

/**
 * Base64-encoded 32 bytes. Encrypts customer notes and praise, and keys the
 * lookup digests for stand, session, and response tokens.
 *
 * Not rotatable without re-encrypting existing rows and recomputing every
 * lookup digest, so it belongs in a managed secret store and in the backup
 * procedure. Losing it makes every encrypted column permanently unreadable.
 */
export function encryptionKey(): Buffer {
  const raw = read("CUSTOMER_NOTE_ENCRYPTION_KEY");
  const key = Buffer.from(raw, "base64");

  if (key.length !== 32) {
    throw new ConfigError(
      "CUSTOMER_NOTE_ENCRYPTION_KEY must be a base64-encoded 32-byte key. " +
        "Generate one with: openssl rand -base64 32",
    );
  }

  return key;
}

/**
 * Startup validation.
 *
 * Call from a health check or a deploy gate to surface a misconfiguration
 * before traffic arrives rather than on the first customer request.
 */
export function validateServerConfig(): { ok: true } | { ok: false; problems: string[] } {
  const problems: string[] = [];

  for (const check of [publicFrontendUrl, supabaseUrl, supabaseServiceRoleKey, encryptionKey]) {
    try {
      check();
    } catch (error) {
      problems.push(error instanceof Error ? error.message : "Unknown configuration error.");
    }
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
