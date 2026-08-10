#!/usr/bin/env node
/**
 * Mint a review stand against the local database and print its URL.
 *
 * The token is generated here and only its keyed digest is stored, which is the
 * whole point — there is no way to recover a token from the database, so the
 * only moment it exists in readable form is this one. Copy the URL now.
 *
 *   node scripts/backend/seed-stand.mjs
 *   node scripts/backend/seed-stand.mjs --location <uuid> --label "Front Desk"
 *
 * Requires a running local stack (`supabase start`) and the same
 * CUSTOMER_NOTE_ENCRYPTION_KEY the app uses, or the digest will not match what
 * the API computes and the stand will look inactive.
 */

import { createHmac, randomBytes } from "node:crypto";
import { argv, env, exit } from "node:process";

const DEFAULT_LOCATION = "aaaa1111-1111-1111-1111-111111111111";
const DEFAULT_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function argument(name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

const encryptionKey = env.CUSTOMER_NOTE_ENCRYPTION_KEY;
if (!encryptionKey) {
  console.error(
    "CUSTOMER_NOTE_ENCRYPTION_KEY is required, and must match the one the app uses.\n" +
      "Generate one with:  openssl rand -base64 32",
  );
  exit(1);
}

const key = Buffer.from(encryptionKey, "base64");
if (key.length !== 32) {
  console.error("CUSTOMER_NOTE_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  exit(1);
}

// Must match lib/server/crypto.ts exactly: same domain string, same key. A
// mismatch here produces a stand that exists and can never be resolved.
const token = randomBytes(32).toString("base64url");
const digest = createHmac("sha256", key).update(`stand_token:${token}`).digest("hex");

const locationId = argument("location", DEFAULT_LOCATION);
const label = argument("label", "Front Desk");
const frontendOrigin = env.PUBLIC_FRONTEND_URL ?? "http://localhost:3000";

const sql = `
insert into public.review_stands
    (org_id, location_id, public_token_hash, public_token_prefix, label, status, activated_at)
select l.org_id, l.id, '${digest}', '${token.slice(0, 8)}', '${label.replace(/'/g, "''")}',
       'active', now()
  from public.locations l
 where l.id = '${locationId}'
returning id;
`;

const { execFile } = await import("node:child_process");
const { promisify } = await import("node:util");
const run = promisify(execFile);

try {
  // Routed through the running container so the script needs no local psql.
  const { stdout } = await run("docker", [
    "exec",
    "-i",
    "supabase_db_reviewboost",
    "psql",
    env.DATABASE_URL ?? DEFAULT_DB,
    "-t",
    "-A",
    "-c",
    sql,
  ]);

  const standId = stdout.trim();
  if (!standId) {
    console.error(`No location ${locationId}. Run \`supabase db reset\` to apply the seed first.`);
    exit(1);
  }

  console.log("Stand created.\n");
  console.log(`  stand id   ${standId}`);
  console.log(`  location   ${locationId}`);
  console.log(`  label      ${label}\n`);
  console.log("  Open this on a phone or paste it into a browser:\n");
  console.log(`    ${frontendOrigin}/q/${token}\n`);
  console.log("  The token is not recoverable from the database. Copy it now.");
} catch (error) {
  console.error("Could not create the stand.");
  console.error(error instanceof Error ? error.message : error);
  exit(1);
}
