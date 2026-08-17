#!/usr/bin/env node
/**
 * Mint a review stand against a remote Supabase project and print its URL.
 *
 * Unlike seed-stand.mjs this connects via the Supabase REST API, so it needs
 * no Docker container and no local psql. It is intended for preview/staging
 * environments where the developer has the service role key.
 *
 *   Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CUSTOMER_NOTE_ENCRYPTION_KEY,
 *   and PUBLIC_FRONTEND_URL in your shell, then run:
 *
 *     node scripts/backend/seed-stand-remote.mjs --i-am-targeting-staging
 *
 *   With an explicit digest key and location:
 *
 *     node scripts/backend/seed-stand-remote.mjs --i-am-targeting-staging --location <uuid>
 *
 * The token is printed once and is not recoverable from the database.
 */

import { createHmac, randomBytes } from "node:crypto";
import { argv, env, exit } from "node:process";

// ----------------------------------------------------------------- safety --

if (env.NODE_ENV === "production") {
  console.error("Refused: this script must not run with NODE_ENV=production.");
  exit(1);
}

if (env.VERCEL_ENV === "production") {
  console.error("Refused: this script must not run on a production Vercel deployment.");
  exit(1);
}

if (!argv.includes("--i-am-targeting-staging")) {
  console.error(
    "Safety: pass --i-am-targeting-staging to confirm you are not pointing at production.\n" +
      "The script decides the target from SUPABASE_URL alone, and NODE_ENV is often unset\n" +
      "in a developer shell, so this flag is an explicit acknowledgement.",
  );
  exit(1);
}

// ----------------------------------------------------------- configuration --

const supabaseUrl = env.SUPABASE_URL?.trim();
if (!supabaseUrl) {
  console.error("SUPABASE_URL is required.");
  exit(1);
}

const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!serviceRoleKey) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is required.");
  exit(1);
}

const encryptionKeyRaw = env.TOKEN_DIGEST_KEY?.trim() || env.CUSTOMER_NOTE_ENCRYPTION_KEY?.trim();
if (!encryptionKeyRaw) {
  console.error(
    "TOKEN_DIGEST_KEY or CUSTOMER_NOTE_ENCRYPTION_KEY is required.\n" +
      "It must match the key the deployed app uses. Generate one with:\n" +
      "  openssl rand -base64 32",
  );
  exit(1);
}

const key = Buffer.from(encryptionKeyRaw, "base64");
if (key.length !== 32) {
  console.error("The token digest key must be a base64-encoded 32-byte key.");
  exit(1);
}

function argument(name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

const locationId = argument("location", "aaaa1111-1111-1111-1111-111111111111");
const label = argument("label", "Staging Stand");
const frontendOrigin = env.PUBLIC_FRONTEND_URL?.trim() ?? "http://localhost:3000";

const hasExplicitDigestKey = !!env.TOKEN_DIGEST_KEY?.trim();
const rawKeyVersion = env.TOKEN_DIGEST_KEY_VERSION?.trim();

if (hasExplicitDigestKey && !rawKeyVersion) {
  console.error(
    "TOKEN_DIGEST_KEY_VERSION is required when TOKEN_DIGEST_KEY is set.\n" +
      "Without it the stand is marked version 1 while its digest uses the current key,\n" +
      "and the lazy upgrade can never resolve the mismatch.",
  );
  exit(1);
}

const keyVersion = Number(rawKeyVersion ?? "1") || 1;

// --------------------------------------------------------- token + digest --

const token = randomBytes(32).toString("base64url");
const prefix = token.slice(0, 8);
const digest = createHmac("sha256", key).update(`stand_token:${token}`).digest("hex");

// -------------------------------------------------------- look up location --

async function supabaseRest(path, { method = "GET", body, prefer } = {}) {
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;

  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${method} ${path} → ${res.status}: ${text}`);
  }

  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("json")) return res.json();
  return null;
}

// Verify the location exists and grab the org_id.
const locations = await supabaseRest(
  `locations?id=eq.${locationId}&select=id,org_id,name&limit=1`,
);

if (!locations || locations.length === 0) {
  console.error(
    `No location with id ${locationId}.\n` +
      "Pass --location <uuid> or seed the database first.",
  );
  exit(1);
}

const location = locations[0];

// ------------------------------------------------------------ insert stand --

const [inserted] = await supabaseRest("review_stands", {
  method: "POST",
  prefer: "return=representation",
  body: {
    org_id: location.org_id,
    location_id: location.id,
    public_token_hash: digest,
    public_token_prefix: prefix,
    public_token_key_version: keyVersion,
    label,
    status: "active",
    activated_at: new Date().toISOString(),
  },
});

if (!inserted?.id) {
  console.error("Insert returned no data. The stand may not have been created.");
  exit(1);
}

// ----------------------------------------------------------------- output --

console.log("Stand created.\n");
console.log(`  stand id     ${inserted.id}`);
console.log(`  org          ${location.org_id}`);
console.log(`  location     ${location.id} (${location.name})`);
console.log(`  label        ${label}`);
console.log(`  key version  ${keyVersion}\n`);
console.log("  Customer URL (open in a browser or on a phone):\n");
console.log(`    ${frontendOrigin}/q/${token}\n`);
console.log("  The token is not recoverable from the database. Copy it now.");
