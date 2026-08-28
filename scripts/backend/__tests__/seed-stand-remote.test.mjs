import { test } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  CONTENT_KEY_VERSION,
  ConfigError,
  assertStagingTarget,
  digestStandToken,
  encryptToken,
  generateToken,
  keyedDigest,
  parseBase64Key,
  parseDigestKeyVersion,
  parseFrontendUrl,
  parseLabel,
  parseLocationId,
  parseSupabaseUrl,
  sanitizeSupabaseError,
  tokenPrefix,
} from "../seed-stand-remote.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "..", "seed-stand-remote.mjs");
const B64_32 = Buffer.alloc(32, 7).toString("base64");
const B64_31 = Buffer.alloc(31, 7).toString("base64");
const STAGING_REF = "abcdefghijklmnopqrst";
const STAGING_URL = `https://${STAGING_REF}.supabase.co`;

function expectRefusal(runResult, ...phrases) {
  assert.notEqual(runResult.status, 0, "expected non-zero exit");
  const combined = `${runResult.stderr}${runResult.stdout}`;
  for (const phrase of phrases) {
    assert.match(combined, new RegExp(phrase, "i"));
  }
}

function runCli(envOverrides = {}, args = []) {
  return spawnSync(process.execPath, [CLI, ...args], {
    env: { ...envOverrides },
    encoding: "utf8",
  });
}

// ------------------------------------------ CLI-level refusals (subprocess)

test("NODE_ENV=production refuses", () => {
  const result = runCli(
    {
      NODE_ENV: "production",
      SUPABASE_URL: STAGING_URL,
      SUPABASE_SERVICE_ROLE_KEY: "svc",
      STAGING_SUPABASE_PROJECT_REF: STAGING_REF,
      CUSTOMER_NOTE_ENCRYPTION_KEY: B64_32,
      PUBLIC_FRONTEND_URL: "https://staging.example.com",
    },
    ["--i-am-targeting-staging", "--location", "11111111-1111-1111-1111-111111111111"],
  );
  expectRefusal(result, "NODE_ENV=production");
});

test("VERCEL_ENV=production refuses", () => {
  const result = runCli(
    {
      VERCEL_ENV: "production",
      SUPABASE_URL: STAGING_URL,
      SUPABASE_SERVICE_ROLE_KEY: "svc",
      STAGING_SUPABASE_PROJECT_REF: STAGING_REF,
      CUSTOMER_NOTE_ENCRYPTION_KEY: B64_32,
      PUBLIC_FRONTEND_URL: "https://staging.example.com",
    },
    ["--i-am-targeting-staging", "--location", "11111111-1111-1111-1111-111111111111"],
  );
  expectRefusal(result, "VERCEL_ENV=production");
});

test("missing --i-am-targeting-staging refuses", () => {
  const result = runCli(
    {
      SUPABASE_URL: STAGING_URL,
      SUPABASE_SERVICE_ROLE_KEY: "svc",
      STAGING_SUPABASE_PROJECT_REF: STAGING_REF,
      CUSTOMER_NOTE_ENCRYPTION_KEY: B64_32,
      PUBLIC_FRONTEND_URL: "https://staging.example.com",
    },
    ["--location", "11111111-1111-1111-1111-111111111111"],
  );
  expectRefusal(result, "--i-am-targeting-staging");
});

test("missing SUPABASE_URL refuses", () => {
  const result = runCli(
    {
      SUPABASE_SERVICE_ROLE_KEY: "svc",
      STAGING_SUPABASE_PROJECT_REF: STAGING_REF,
      CUSTOMER_NOTE_ENCRYPTION_KEY: B64_32,
      PUBLIC_FRONTEND_URL: "https://staging.example.com",
    },
    ["--i-am-targeting-staging", "--location", "11111111-1111-1111-1111-111111111111"],
  );
  expectRefusal(result, "SUPABASE_URL");
});

test("HTTP Supabase URL refuses", () => {
  assert.throws(() => parseSupabaseUrl("http://abcdefghijklmnopqrst.supabase.co"), /HTTPS/);
});

test("malformed Supabase URL refuses", () => {
  assert.throws(() => parseSupabaseUrl("not a url"), /valid URL/);
  assert.throws(() => parseSupabaseUrl("https://abcdefghijklmnopqrst.supabase.co/some/path"), /host only/);
  assert.throws(
    () => parseSupabaseUrl("https://abcdefghijklmnopqrst.supabase.co?x=1"),
    /query string or fragment/,
  );
  assert.throws(
    () => parseSupabaseUrl("https://user:pw@abcdefghijklmnopqrst.supabase.co"),
    /credentials/,
  );
  assert.throws(() => parseSupabaseUrl("https://not-supabase.example.com"), /hosted Supabase project/);
});

test("wrong-project-ref mismatch refuses (would-be production credentials)", () => {
  assert.throws(
    () =>
      assertStagingTarget({
        nodeEnv: "development",
        vercelEnv: undefined,
        acknowledged: true,
        expectedProjectRef: "expectedstagingprojref",
        observedProjectRef: "productionprojectxxxx",
      }),
    /positive-identity check/,
  );
});

test("matching staging project ref passes target validation", () => {
  assert.doesNotThrow(() =>
    assertStagingTarget({
      nodeEnv: "development",
      vercelEnv: undefined,
      acknowledged: true,
      expectedProjectRef: STAGING_REF,
      observedProjectRef: STAGING_REF,
    }),
  );
});

test("missing STAGING_SUPABASE_PROJECT_REF refuses", () => {
  assert.throws(
    () =>
      assertStagingTarget({
        nodeEnv: "development",
        vercelEnv: undefined,
        acknowledged: true,
        expectedProjectRef: undefined,
        observedProjectRef: STAGING_REF,
      }),
    /STAGING_SUPABASE_PROJECT_REF is required/,
  );
});

test("missing service-role key refuses", () => {
  const result = runCli(
    {
      SUPABASE_URL: STAGING_URL,
      STAGING_SUPABASE_PROJECT_REF: STAGING_REF,
      CUSTOMER_NOTE_ENCRYPTION_KEY: B64_32,
      PUBLIC_FRONTEND_URL: "https://staging.example.com",
    },
    ["--i-am-targeting-staging", "--location", "11111111-1111-1111-1111-111111111111"],
  );
  expectRefusal(result, "SUPABASE_SERVICE_ROLE_KEY");
});

test("missing CUSTOMER_NOTE_ENCRYPTION_KEY refuses", () => {
  const result = runCli(
    {
      SUPABASE_URL: STAGING_URL,
      SUPABASE_SERVICE_ROLE_KEY: "svc",
      STAGING_SUPABASE_PROJECT_REF: STAGING_REF,
      PUBLIC_FRONTEND_URL: "https://staging.example.com",
    },
    ["--i-am-targeting-staging", "--location", "11111111-1111-1111-1111-111111111111"],
  );
  expectRefusal(result, "CUSTOMER_NOTE_ENCRYPTION_KEY");
});

test("malformed encryption key refuses", () => {
  assert.throws(() => parseBase64Key(B64_31, "CUSTOMER_NOTE_ENCRYPTION_KEY"), /32-byte key/);
});

test("malformed digest key refuses", () => {
  assert.throws(() => parseBase64Key(B64_31, "TOKEN_DIGEST_KEY"), /32-byte key/);
});

test("invalid digest key version refuses", () => {
  assert.throws(() => parseDigestKeyVersion("abc", false), /positive integer/);
  assert.throws(() => parseDigestKeyVersion("0", false), /1 and 32767/);
  assert.throws(() => parseDigestKeyVersion("40000", false), /1 and 32767/);
  assert.throws(() => parseDigestKeyVersion(undefined, true), /required when TOKEN_DIGEST_KEY/);
  assert.equal(parseDigestKeyVersion(undefined, false), 1);
  assert.equal(parseDigestKeyVersion("2", true), 2);
});

test("missing --location refuses", () => {
  assert.throws(() => parseLocationId(undefined), /--location <uuid> is required/);
  assert.throws(() => parseLocationId(""), /required/);
});

test("invalid --location UUID refuses", () => {
  assert.throws(() => parseLocationId("not-a-uuid"), /valid UUID/);
});

test("empty label refuses", () => {
  assert.throws(() => parseLabel("   "), /1 and 80/);
});

test("overlong label refuses", () => {
  assert.throws(() => parseLabel("x".repeat(81)), /1 and 80/);
});

// -------------------------------------------------- crypto/token behavior

test("valid token is 32 random bytes encoded as base64url", () => {
  const t = generateToken();
  // base64url of 32 bytes = 43 chars (no padding)
  assert.equal(t.length, 43);
  assert.match(t, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(t, generateToken()); // random, so overwhelmingly not equal
  assert.equal(tokenPrefix(t).length, 8);
});

test("digest matches the current application HMAC-SHA256 stand_token algorithm", () => {
  const key = randomBytes(32);
  const token = "fixed-token-value";
  const expected = keyedDigest(token, "stand_token", key);
  assert.equal(digestStandToken(token, key), expected);
  // And matches the low-level HMAC directly, mirroring frontend/lib/server/crypto.ts.
  const raw = createHmacHex(key, `stand_token:${token}`);
  assert.equal(digestStandToken(token, key), raw);
});

function createHmacHex(key, message) {
  // Local recomputation to prove the algorithm is HMAC-SHA256 over
  // `stand_token:<token>` — the same wire format the app validates.
  return createHmac("sha256", key).update(message).digest("hex");
}

test("encrypted token matches v1:<iv>:<tag>:<ciphertext> shape", () => {
  const key = randomBytes(32);
  const ct = encryptToken("some-token", key);
  const parts = ct.split(":");
  assert.equal(parts.length, 4);
  assert.equal(parts[0], "v1");
  assert.equal(Buffer.from(parts[1], "base64").length, 12); // IV
  assert.equal(Buffer.from(parts[2], "base64").length, 16); // GCM tag
  assert.ok(Buffer.from(parts[3], "base64").length >= 1);
});

test("encrypted token round-trips with the same content key", () => {
  const key = randomBytes(32);
  const token = generateToken();
  const ct = encryptToken(token, key);
  const [, iv, tag, ciphertext] = ct.split(":");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  assert.equal(plaintext, token);
});

test("PUBLIC_FRONTEND_URL validated", () => {
  assert.throws(() => parseFrontendUrl(""), /required/);
  assert.throws(() => parseFrontendUrl("ftp://example.com"), /HTTP or HTTPS/);
  assert.throws(() => parseFrontendUrl("https://u:p@example.com"), /credentials/);
  assert.throws(() => parseFrontendUrl("https://example.com/path"), /host\[:port\] only/);
  assert.equal(parseFrontendUrl("https://staging.example.com/"), "https://staging.example.com");
});

test("CONTENT_KEY_VERSION mirrors the app's KEY_VERSION constant (1)", () => {
  assert.equal(CONTENT_KEY_VERSION, 1);
});

// ------------------------------------------------------ error redaction

test("sanitizeSupabaseError trims long bodies and does not echo secrets from headers", () => {
  const message = sanitizeSupabaseError(500, "x".repeat(10000));
  assert.ok(message.length < 500);
  assert.match(message, /HTTP 500/);
});

test("normal output/error fixtures do not leak secrets", () => {
  // With a mismatched project ref the process refuses BEFORE touching the
  // network; the observed ref must not be echoed back either.
  const result = runCli(
    {
      SUPABASE_URL: "https://productionprojectxxxx.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "sensitive-service-role-key-should-not-appear",
      STAGING_SUPABASE_PROJECT_REF: STAGING_REF,
      CUSTOMER_NOTE_ENCRYPTION_KEY: B64_32,
      PUBLIC_FRONTEND_URL: "https://staging.example.com",
    },
    ["--i-am-targeting-staging", "--location", "11111111-1111-1111-1111-111111111111"],
  );
  expectRefusal(result, "positive-identity check");
  const combined = `${result.stderr}${result.stdout}`;
  assert.doesNotMatch(combined, /sensitive-service-role-key-should-not-appear/);
  assert.doesNotMatch(combined, new RegExp(B64_32.replace(/[+/=]/g, "\\$&")));
  assert.doesNotMatch(combined, /productionprojectxxxx/);
});

test("ConfigError instances are the module's export", () => {
  assert.ok(new ConfigError("x") instanceof ConfigError);
});
