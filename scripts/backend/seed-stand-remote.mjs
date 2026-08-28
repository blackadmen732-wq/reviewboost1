#!/usr/bin/env node
/**
 * Mint a review stand against a positively-verified STAGING Supabase project
 * and print its one-time customer URL. STAGING ONLY.
 *
 *   Required env:
 *     SUPABASE_URL                        https://<project-ref>.supabase.co
 *     SUPABASE_SERVICE_ROLE_KEY           service-role JWT
 *     STAGING_SUPABASE_PROJECT_REF        must equal <project-ref> extracted
 *                                         from SUPABASE_URL — an expected-ref
 *                                         guard against pointing the CLI at
 *                                         an unintended project. It is NOT
 *                                         independent proof that the target
 *                                         is non-production: both values are
 *                                         operator-supplied. Real safety
 *                                         requires this env var to be sourced
 *                                         from a trusted secrets store and
 *                                         to be the known staging ref.
 *     CUSTOMER_NOTE_ENCRYPTION_KEY        base64 32-byte AES-256 key, must
 *                                         match the deployed app so the stand
 *                                         is reprintable.
 *     PUBLIC_FRONTEND_URL                 the origin printed into the QR URL.
 *
 *   Optional env:
 *     TOKEN_DIGEST_KEY                    base64 32-byte HMAC key; falls back
 *                                         to CUSTOMER_NOTE_ENCRYPTION_KEY,
 *                                         matching frontend/lib/server/env.ts.
 *     TOKEN_DIGEST_KEY_VERSION            integer 1..32767, default 1.
 *                                         REQUIRED when TOKEN_DIGEST_KEY is
 *                                         set (mirrors the app rule).
 *
 *   Required flags:
 *     --location <uuid>                   the staging location under which to
 *                                         create the stand. No default.
 *     --i-am-targeting-staging            human acknowledgement belt.
 *
 *   Optional flags:
 *     --label "Front Desk"                1..80 chars; default "Staging Stand".
 *
 * This is a STAGING administration utility. It is NOT the production stand
 * creation path — production creates stands through the SECURITY-DEFINER
 * onboarding RPC. The utility uses the service-role key to insert the stand
 * directly, which is why the expected-ref guard matters.
 *
 * The plaintext token is emitted exactly once (embedded in the customer URL).
 * The row also carries an AES-256-GCM ciphertext of the token so the stand
 * is reprintable / rotatable through the existing app paths.
 */

import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { argv, env, exit } from "node:process";

// ---------------------------------------------------------------- errors ---

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

// ------------------------------------------------- crypto helpers (pure) ---

// Kept intentionally aligned with frontend/lib/server/crypto.ts. Any drift
// here means the staging-created stand is unresolvable at /q/<token>.
const CIPHER_ALGORITHM = "aes-256-gcm";
const CIPHER_VERSION = "v1";
const CIPHER_IV_BYTES = 12;
export const CONTENT_KEY_VERSION = 1;

export function generateToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function tokenPrefix(token) {
  return token.slice(0, 8);
}

export function keyedDigest(value, domain, key) {
  return createHmac("sha256", key).update(`${domain}:${value}`).digest("hex");
}

export function digestStandToken(token, digestKey) {
  return keyedDigest(token, "stand_token", digestKey);
}

// Emits exactly the format the app's decrypt() accepts:
//   v1:<iv-b64>:<tag-b64>:<ciphertext-b64>
export function encryptToken(plaintext, contentKey) {
  if (plaintext === null || plaintext === undefined || plaintext === "") {
    throw new ConfigError("Refusing to encrypt an empty token.");
  }
  const iv = randomBytes(CIPHER_IV_BYTES);
  const cipher = createCipheriv(CIPHER_ALGORITHM, contentKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    CIPHER_VERSION,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

// --------------------------------------------- validation helpers (pure) ---

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Bare "<ref>.supabase.co"; ref is 20 lowercase letters per Supabase's format,
// but we accept any 16-40 lowercase alphanumeric to avoid false rejects if
// Supabase changes the length. No sub-subdomains, no ports.
const SUPABASE_HOST_RE = /^([a-z0-9]{16,40})\.supabase\.co$/;

export function parseSupabaseUrl(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new ConfigError("SUPABASE_URL is required.");
  }
  const value = raw.trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError("SUPABASE_URL is not a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new ConfigError("SUPABASE_URL must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new ConfigError("SUPABASE_URL must not contain credentials.");
  }
  if (url.search || url.hash) {
    throw new ConfigError("SUPABASE_URL must not contain a query string or fragment.");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new ConfigError("SUPABASE_URL must be scheme://host only.");
  }
  const match = SUPABASE_HOST_RE.exec(url.hostname);
  if (!match) {
    throw new ConfigError(
      "SUPABASE_URL must be a hosted Supabase project of the form https://<project-ref>.supabase.co.",
    );
  }
  return { origin: url.origin, projectRef: match[1] };
}

export function parseFrontendUrl(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new ConfigError("PUBLIC_FRONTEND_URL is required.");
  }
  const value = raw.trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError("PUBLIC_FRONTEND_URL is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError("PUBLIC_FRONTEND_URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new ConfigError("PUBLIC_FRONTEND_URL must not contain credentials.");
  }
  if (url.search || url.hash) {
    throw new ConfigError("PUBLIC_FRONTEND_URL must not contain a query string or fragment.");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new ConfigError("PUBLIC_FRONTEND_URL must be scheme://host[:port] only.");
  }
  return url.origin;
}

// Strict standard-base64 for 32-byte keys. 32 bytes encode to exactly 44
// canonical characters (43 data + one "=" pad). Node's decoder silently drops
// unknown characters, so we validate the alphabet and length ourselves BEFORE
// decoding, then round-trip the decoded bytes back to canonical base64 and
// require an exact string match. That refuses anything the decoder would have
// "helpfully" ignored: internal whitespace or newlines, non-alphabet junk
// like `!!!!`, and off-by-one padding.
const CANONICAL_KEY_LENGTH = 44;
const STRICT_BASE64_32_RE = /^[A-Za-z0-9+/]{43}=$/;

export function parseBase64Key(raw, name) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new ConfigError(`${name} is required.`);
  }
  const trimmed = raw.trim();
  const requireStandard = `${name} must be a canonical base64-encoded 32-byte key (44 chars, trailing "=").`;

  if (trimmed.length !== CANONICAL_KEY_LENGTH) {
    throw new ConfigError(requireStandard);
  }
  if (!STRICT_BASE64_32_RE.test(trimmed)) {
    throw new ConfigError(requireStandard);
  }
  const key = Buffer.from(trimmed, "base64");
  if (key.length !== 32) {
    throw new ConfigError(requireStandard);
  }
  // Canonical round-trip: if the decoder had to skip anything at all, the
  // re-encoded form won't match the input byte-for-byte.
  if (key.toString("base64") !== trimmed) {
    throw new ConfigError(requireStandard);
  }
  return key;
}

export function parseDigestKeyVersion(raw, digestKeyExplicit) {
  if (raw === undefined || raw === null || raw === "") {
    if (digestKeyExplicit) {
      throw new ConfigError(
        "TOKEN_DIGEST_KEY_VERSION is required when TOKEN_DIGEST_KEY is set. " +
          "Without it a stand is marked version 1 while its digest uses the current key.",
      );
    }
    return 1;
  }
  const trimmed = String(raw).trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new ConfigError("TOKEN_DIGEST_KEY_VERSION must be a positive integer.");
  }
  const version = Number(trimmed);
  if (!Number.isInteger(version) || version < 1 || version > 32767) {
    throw new ConfigError("TOKEN_DIGEST_KEY_VERSION must be an integer between 1 and 32767.");
  }
  return version;
}

export function parseLocationId(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new ConfigError(
      "--location <uuid> is required; there is no default staging location.",
    );
  }
  const value = raw.trim();
  if (!UUID_RE.test(value)) {
    throw new ConfigError("--location must be a valid UUID.");
  }
  return value.toLowerCase();
}

export function parseLabel(raw) {
  const value = (raw ?? "Staging Stand").trim();
  if (value.length < 1 || value.length > 80) {
    throw new ConfigError("--label must be between 1 and 80 characters after trimming.");
  }
  return value;
}

// ---------------------------------------------- staging target identity ---

export function assertStagingTarget(config) {
  if (config.nodeEnv === "production") {
    throw new ConfigError("Refused: NODE_ENV=production.");
  }
  if (config.vercelEnv === "production") {
    throw new ConfigError("Refused: VERCEL_ENV=production.");
  }
  if (!config.acknowledged) {
    throw new ConfigError(
      "Safety ack required: pass --i-am-targeting-staging to confirm the target.",
    );
  }
  const expected = (config.expectedProjectRef ?? "").trim();
  if (expected === "") {
    throw new ConfigError(
      "STAGING_SUPABASE_PROJECT_REF is required. It must exactly equal the " +
        "project ref extracted from SUPABASE_URL.",
    );
  }
  if (expected !== config.observedProjectRef) {
    // Never echo the observed ref in case it points at a production project.
    throw new ConfigError(
      "Refused: SUPABASE_URL's project ref does not match STAGING_SUPABASE_PROJECT_REF. " +
        "This is an expected-ref guard, not independent proof of a staging target — " +
        "STAGING_SUPABASE_PROJECT_REF must be sourced from a trusted secrets store " +
        "and be the known staging project ref.",
    );
  }
}

// --------------------------------------------------- REST error redaction --

// The response body is discarded on purpose. PostgREST may echo request
// values inside `message` / `details` / `hint`, and the caller's payload
// contains the token digest and the AES ciphertext. Truncation is not
// sanitization: a short body can still contain a secret. The operator gets
// only the HTTP status, which is enough to look up the run in Supabase logs
// without any request value ever crossing back through the CLI's output.
export function sanitizeSupabaseError(status /* body intentionally ignored */) {
  return `Supabase responded HTTP ${status}.`;
}

// --------------------------------------------------- CLI-only entry point --

function argument(name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

async function supabaseRest(origin, serviceRoleKey, path, { method = "GET", body, prefer } = {}) {
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;

  let res;
  try {
    res = await fetch(`${origin}/rest/v1/${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (networkError) {
    // Distinct signal so the caller can leave the operator uncertain about
    // whether the request reached Supabase, and NOT auto-retry POST.
    const err = new Error("Network error contacting Supabase.");
    err.name = "SupabaseNetworkError";
    err.cause = networkError;
    throw err;
  }

  if (!res.ok) {
    // Body deliberately not read — see sanitizeSupabaseError above.
    throw new Error(sanitizeSupabaseError(res.status));
  }

  let text = "";
  try {
    text = await res.text();
  } catch {
    text = "";
  }

  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function main() {
  // 1. environment
  const nodeEnv = env.NODE_ENV;
  const vercelEnv = env.VERCEL_ENV;

  // 2/3/4. URLs + positive staging identity
  const supabase = parseSupabaseUrl(env.SUPABASE_URL);
  const frontendOrigin = parseFrontendUrl(env.PUBLIC_FRONTEND_URL);

  assertStagingTarget({
    nodeEnv,
    vercelEnv,
    acknowledged: argv.includes("--i-am-targeting-staging"),
    expectedProjectRef: env.STAGING_SUPABASE_PROJECT_REF?.trim(),
    observedProjectRef: supabase.projectRef,
  });

  // 5. keys
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) throw new ConfigError("SUPABASE_SERVICE_ROLE_KEY is required.");

  const contentKey = parseBase64Key(env.CUSTOMER_NOTE_ENCRYPTION_KEY, "CUSTOMER_NOTE_ENCRYPTION_KEY");

  const digestKeyExplicit = typeof env.TOKEN_DIGEST_KEY === "string" && env.TOKEN_DIGEST_KEY.trim() !== "";
  const digestKey = digestKeyExplicit
    ? parseBase64Key(env.TOKEN_DIGEST_KEY, "TOKEN_DIGEST_KEY")
    : contentKey;
  const digestKeyVersion = parseDigestKeyVersion(env.TOKEN_DIGEST_KEY_VERSION, digestKeyExplicit);

  // 6. CLI arguments
  const locationId = parseLocationId(argument("location"));
  const label = parseLabel(argument("label"));

  // 7. compute token + digest + ciphertext locally
  const token = generateToken();
  const digest = digestStandToken(token, digestKey);
  const prefix = tokenPrefix(token);
  const ciphertext = encryptToken(token, contentKey);

  // 8/9. look up the location — no mutation until this succeeds
  const locations = await supabaseRest(
    supabase.origin,
    serviceRoleKey,
    `locations?id=eq.${encodeURIComponent(locationId)}&select=id,org_id,name&limit=1`,
  );

  if (!Array.isArray(locations) || locations.length === 0) {
    throw new ConfigError(`No staging location with id ${locationId}.`);
  }
  const location = locations[0];

  // 10. POST the stand exactly once
  let inserted;
  try {
    const rows = await supabaseRest(supabase.origin, serviceRoleKey, "review_stands", {
      method: "POST",
      prefer: "return=representation",
      body: {
        org_id: location.org_id,
        location_id: location.id,
        public_token_hash: digest,
        public_token_prefix: prefix,
        public_token_key_version: digestKeyVersion,
        public_token_encrypted: ciphertext,
        token_encryption_key_version: CONTENT_KEY_VERSION,
        label,
        status: "active",
        activated_at: new Date().toISOString(),
      },
    });
    inserted = Array.isArray(rows) ? rows[0] : null;
  } catch (error) {
    if (error && error.name === "SupabaseNetworkError") {
      console.error(
        "Stand creation result is unknown; verify staging before retrying. " +
          "The POST may or may not have reached Supabase.",
      );
      exit(2);
    }
    throw error;
  }

  if (!inserted?.id) {
    console.error("Stand creation result is unknown; the response contained no row id.");
    exit(2);
  }

  // 11. output — no secrets
  console.log("Stand created.\n");
  console.log(`  stand id           ${inserted.id}`);
  console.log(`  org                ${location.org_id}`);
  console.log(`  location           ${location.id} (${location.name ?? ""})`);
  console.log(`  label              ${label}`);
  console.log(`  digest key version ${digestKeyVersion}\n`);
  console.log("  Customer URL (open on a phone; this is the only time it exists):\n");
  console.log(`    ${frontendOrigin}/q/${token}\n`);
}

// Only run main() when invoked as a CLI. When imported (e.g. by tests), the
// module exposes its pure helpers without any side effects.
const invokedAsCli = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === new URL(`file://${entry}`).href;
  } catch {
    return false;
  }
})();

if (invokedAsCli) {
  main().catch((error) => {
    if (error instanceof ConfigError) {
      console.error(error.message);
      exit(1);
    }
    // Never dump raw Supabase text as-is: sanitizeSupabaseError above already
    // trims and framed the message.
    console.error(error instanceof Error ? error.message : String(error));
    exit(1);
  });
}
