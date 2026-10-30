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
 * Which deployment this is — not which build.
 *
 * `NODE_ENV=production` is true for every Vercel Preview as well as for the
 * deployment paying customers use, so it cannot be what decides whether fake
 * SMS or a development key fallback is acceptable. The tier is:
 *
 *   APP_ENV, if set: production | staging | preview | development | test
 *   else VERCEL_ENV:  production | preview | development
 *   else a production build on an unknown host: production (the strict one)
 *   else development.
 *
 * APP_ENV may narrow Vercel's production to `staging` (a staging project's
 * production target), but may never relax it to preview, development or
 * test: a stray variable must not switch the paying-customer deployment
 * into a mode that fakes SMS.
 */
export type DeploymentTier = "production" | "staging" | "preview" | "development" | "test";

const TIERS: readonly DeploymentTier[] = ["production", "staging", "preview", "development", "test"];

export function deploymentTier(): DeploymentTier {
  const vercel = process.env.VERCEL_ENV?.trim().toLowerCase();
  const explicit = process.env.APP_ENV?.trim().toLowerCase();

  if (explicit) {
    if (!(TIERS as readonly string[]).includes(explicit)) {
      throw new ConfigError(`APP_ENV must be one of ${TIERS.join(", ")}.`);
    }
    if (vercel === "production" && explicit !== "production" && explicit !== "staging") {
      throw new ConfigError(
        `APP_ENV=${explicit} is not allowed on a Vercel production deployment. ` +
          "Only production or staging may run there.",
      );
    }
    return explicit as DeploymentTier;
  }

  if (vercel === "production") return "production";
  if (vercel === "preview") return "preview";
  if (vercel === "development") return "development";
  if (process.env.NODE_ENV === "test") return "test";
  if (isProduction()) return "production";
  return "development";
}

/** Real customers, real money, real messages. */
export function isPaidProductionTier(): boolean {
  return deploymentTier() === "production";
}

function decode32(name: string, raw: string): Buffer {
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new ConfigError(
      `${name} must be a base64-encoded 32-byte key. Generate one with: openssl rand -base64 32`,
    );
  }
  return key;
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
 * The publishable (anon) key.
 *
 * Safe in a browser by design — it grants nothing on its own, because every
 * table denies `anon` and RLS decides what an authenticated session may see.
 * The owner API uses it to build a client carrying the caller's own token, so
 * their queries run under RLS rather than under the service role.
 */
export function supabaseAnonKey(): string {
  return (
    process.env.SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    read("SUPABASE_ANON_KEY")
  );
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
 * The key that produces stand, session, and response token digests.
 *
 * Deliberately separate from `CUSTOMER_NOTE_ENCRYPTION_KEY`, because the two
 * rotate on completely different terms. Encrypted content can be re-encrypted;
 * a digest cannot be recomputed without the original token, and we do not keep
 * those. Sharing one key would mean rotating it after a note-key exposure
 * invalidated every printed QR code in the field.
 *
 * Outside production it falls back to the encryption key so a fresh local
 * install needs one fewer secret. In production it must be set, and must not
 * be the encryption key: a Tag printed against the fallback is tied to the
 * wrong key for as long as it sits on a table. A deployment that already
 * issued Tags under the fallback moves off it with an ordinary rotation —
 * TOKEN_DIGEST_KEY_PREVIOUS = the old (encryption) key, a new
 * TOKEN_DIGEST_KEY, and TOKEN_DIGEST_KEY_VERSION incremented — see
 * docs/backend/LAUNCH_GATE.md.
 */
export function tokenDigestKey(): Buffer {
  const raw = process.env.TOKEN_DIGEST_KEY?.trim();

  if (!raw) {
    if (isPaidProductionTier()) {
      throw new ConfigError(
        "TOKEN_DIGEST_KEY is required in production. It must be an independent 32-byte key, " +
          "not a fallback to CUSTOMER_NOTE_ENCRYPTION_KEY.",
      );
    }
    return encryptionKey();
  }

  const key = decode32("TOKEN_DIGEST_KEY", raw);
  if (isPaidProductionTier() && key.equals(encryptionKey())) {
    throw new ConfigError(
      "TOKEN_DIGEST_KEY must differ from CUSTOMER_NOTE_ENCRYPTION_KEY in production.",
    );
  }
  return key;
}

/**
 * The key being rotated away from, during a rotation only.
 *
 * While set, a stand whose digest was produced by it still resolves, and is
 * rewritten under the current key the first time it is scanned. Unset it once
 * `public_token_key_version` shows no stands left on the old version.
 */
export function previousTokenDigestKey(): Buffer | null {
  const raw = process.env.TOKEN_DIGEST_KEY_PREVIOUS?.trim();
  if (!raw) return null;

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new ConfigError("TOKEN_DIGEST_KEY_PREVIOUS must be a base64-encoded 32-byte key.");
  }
  return key;
}

/**
 * Which key version new and upgraded digests are written under.
 *
 * Increment alongside TOKEN_DIGEST_KEY so the lazy upgrade knows a stand is
 * behind. Leaving it unchanged during a rotation would make every stand look
 * current and the migration would never happen.
 */
export function tokenDigestKeyVersion(): number {
  const raw = process.env.TOKEN_DIGEST_KEY_VERSION?.trim();
  if (!raw) {
    // In production the version is part of the key's identity: a rotation
    // that forgets to set it looks current and never migrates a Tag.
    if (isPaidProductionTier()) {
      throw new ConfigError("TOKEN_DIGEST_KEY_VERSION is required in production.");
    }
    return 1;
  }

  const version = Number(raw);
  if (!Number.isInteger(version) || version < 1 || version > 32767) {
    throw new ConfigError("TOKEN_DIGEST_KEY_VERSION must be an integer between 1 and 32767.");
  }
  return version;
}

/**
 * Startup validation.
 *
 * Call from a health check or a deploy gate to surface a misconfiguration
 * before traffic arrives rather than on the first customer request.
 */
// ------------------------------------------------------------- Stripe -----

/**
 * The Stripe secret key.
 *
 * Server-only, and never given a development fallback: a billing path that
 * silently does nothing because a key was missing is worse than one that
 * refuses, because the business believes it is subscribed.
 */
export function stripeSecretKey(): string {
  const key = read("STRIPE_SECRET_KEY");
  const live = /^(sk|rk)_live_/.test(key);
  const test = /^(sk|rk)_test_/.test(key);

  // The readiness gate also checks this, but it must hold on the actual
  // payment path even if someone bypasses the gate or removes monitoring.
  if (!live && !test) {
    throw new ConfigError("STRIPE_SECRET_KEY must be a Stripe secret or restricted key.");
  }
  if (isPaidProductionTier() && !live) {
    throw new ConfigError("STRIPE_SECRET_KEY must use live mode in production.");
  }
  if (!isPaidProductionTier() && !test) {
    throw new ConfigError("STRIPE_SECRET_KEY must use test mode outside production.");
  }

  return key;
}

/**
 * The webhook signing secret.
 *
 * Without it a webhook cannot be verified, and an unverified webhook is
 * anyone on the internet writing a business's billing state. There is no
 * "skip verification in development" branch, because that branch is the one
 * that eventually ships.
 */
export function stripeWebhookSecret(): string {
  return read("STRIPE_WEBHOOK_SECRET");
}

/**
 * Stripe price ids for the three plans.
 *
 * A plan whose price id is missing cannot be sold — the checkout refuses
 * rather than starting a subscription at whatever price happened to be
 * configured somewhere else.
 */
export function stripePriceId(planId: "starter" | "growth" | "pro"): string {
  switch (planId) {
    case "starter":
      return read("STRIPE_PRICE_STARTER");
    case "growth":
      return read("STRIPE_PRICE_GROWTH");
    case "pro":
      return read("STRIPE_PRICE_PRO");
  }
}

/** Reverse of `stripePriceId`, for reading a subscription back. */
export function planIdForPrice(priceId: string | null): "starter" | "growth" | "pro" | null {
  if (!priceId) return null;
  for (const plan of ["starter", "growth", "pro"] as const) {
    try {
      if (stripePriceId(plan) === priceId) return plan;
    } catch {
      // A plan that is not configured simply cannot match.
    }
  }
  return null;
}

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
