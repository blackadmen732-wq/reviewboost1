// Tests for scripts/dev/setup-local-env.sh.
//
// The script is exercised as a subprocess against a throwaway copy of the
// repository layout, with the pinned Supabase CLI replaced by a stub through
// SUPABASE_CLI_BIN. Nothing here touches a real Supabase stack, Docker, or the
// developer's own frontend/.env.local.
//
// Variable names live in constants and fixture lines are built by `assign`, so
// this file holds no literal `NAME=value` secret assignment either — the same
// constraint the generator is under, and the last test enforces it on both.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const SCRIPT_SOURCES = ["scripts/dev/setup-local-env.sh", "scripts/dev/tool-versions.sh"];

const NAME_NOTE_ENCRYPTION = "CUSTOMER_NOTE_ENCRYPTION_KEY";
const NAME_DIGEST = "TOKEN_DIGEST_KEY";
const NAME_DIGEST_PREVIOUS = "TOKEN_DIGEST_KEY_PREVIOUS";
const NAME_DIGEST_VERSION = "TOKEN_DIGEST_KEY_VERSION";
const NAME_SUPABASE_URL = "SUPABASE_URL";

const assign = (name, value) => `${name}=${value}`;
const envFile = (...lines) => `${lines.join("\n")}\n`;

const API_URL = "http://127.0.0.1:54321";
const ANON_KEY = "local-anon-key-for-tests";
const SERVICE_ROLE_KEY = "local-service-role-key-for-tests";

// Distinguishable base64 32-byte values, so a substituted key is visible.
const b64Key = (fill) => Buffer.alloc(32, fill).toString("base64");
const CONFIGURED_NOTE_KEY = b64Key(0x11);
const CONFIGURED_DIGEST_KEY = b64Key(0x22);
const CONFIGURED_PREVIOUS_DIGEST_KEY = b64Key(0x33);

const STATUS_STUBS = {
  // A healthy `supabase status -o env`.
  ok: `cat <<'STATUS'
API_URL="${API_URL}"
ANON_KEY="${ANON_KEY}"
SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY}"
STATUS
`,
  // The stack is not running.
  failure: `echo "Docker is not running or the project is not started." >&2
exit 7
`,
  // Up, but not reporting everything the frontend needs.
  incomplete: `cat <<'STATUS'
API_URL="${API_URL}"
ANON_KEY="${ANON_KEY}"
STATUS
`,
};

/**
 * Build an isolated repository containing only what the script needs, plus a
 * stub CLI. Returns the paths the tests operate on.
 */
function makeWorkspace({ status = "ok", existingEnv = null, existingEnvMode = 0o600 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "setup-local-env-"));
  fs.mkdirSync(path.join(root, "scripts", "dev"), { recursive: true });
  fs.mkdirSync(path.join(root, "frontend"), { recursive: true });
  fs.mkdirSync(path.join(root, "bin"), { recursive: true });

  for (const relative of SCRIPT_SOURCES) {
    fs.copyFileSync(path.join(REPO_ROOT, relative), path.join(root, relative));
  }

  const stub = path.join(root, "bin", "supabase");
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "status" ]]; then
${STATUS_STUBS[status]}fi
exit 0
`,
    { mode: 0o755 },
  );

  const target = path.join(root, "frontend", ".env.local");
  if (existingEnv !== null) {
    fs.writeFileSync(target, existingEnv, { mode: existingEnvMode });
    fs.chmodSync(target, existingEnvMode);
  }

  return { root, envFile: target, script: path.join(root, "scripts", "dev", "setup-local-env.sh"), stub };
}

/** Run the script. `umask` wraps it so the file mode can be tested. */
function run(workspace, { umask = null } = {}) {
  const command =
    umask === null ? [workspace.script] : ["-c", `umask ${umask}; exec bash "$0"`, workspace.script];
  return spawnSync("bash", command, {
    encoding: "utf8",
    env: { ...process.env, SUPABASE_CLI_BIN: workspace.stub },
  });
}

function expectSuccess(result) {
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stderr}`);
  return result;
}

/** Parse the generated file into a name → value map. */
function readEnv(file) {
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    assert.notEqual(separator, -1, `unparsable line: ${line}`);
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

function modeOf(file) {
  return (fs.statSync(file).mode & 0o777).toString(8);
}

// ------------------------------------------------------------ fresh generation

test("fresh environment: writes Supabase values and mints an encryption key", () => {
  const workspace = makeWorkspace();
  expectSuccess(run(workspace));
  const env = readEnv(workspace.envFile);

  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, API_URL);
  assert.equal(env.SUPABASE_URL, API_URL);
  assert.equal(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, ANON_KEY);
  assert.equal(env.SUPABASE_ANON_KEY, ANON_KEY);
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, SERVICE_ROLE_KEY);
  assert.equal(env.PUBLIC_FRONTEND_URL, "http://localhost:3000");
  assert.equal(env.NEXT_PUBLIC_USE_CUSTOMER_FIXTURES, "false");
  assert.equal(env.NEXT_PUBLIC_API_BASE_URL, "");
  assert.equal(env.SMS_PROVIDER, "fake");

  // A real, freshly generated 32-byte key.
  assert.equal(Buffer.from(env.CUSTOMER_NOTE_ENCRYPTION_KEY, "base64").length, 32);

  // No digest key was configured, so none is invented and none is substituted.
  assert.equal(env.TOKEN_DIGEST_KEY, undefined);
  assert.equal(env.TOKEN_DIGEST_KEY_PREVIOUS, undefined);
  assert.equal(env.TOKEN_DIGEST_KEY_VERSION, "1");
});

test("fresh environment: two runs in different workspaces mint different keys", () => {
  const first = makeWorkspace();
  const second = makeWorkspace();
  expectSuccess(run(first));
  expectSuccess(run(second));

  assert.notEqual(
    readEnv(first.envFile).CUSTOMER_NOTE_ENCRYPTION_KEY,
    readEnv(second.envFile).CUSTOMER_NOTE_ENCRYPTION_KEY,
  );
});

// -------------------------------------------------------------- preservation

test("preserves an existing encryption key so local rows stay decryptable", () => {
  const workspace = makeWorkspace({
    existingEnv: envFile(
      assign(NAME_NOTE_ENCRYPTION, CONFIGURED_NOTE_KEY),
      assign(NAME_SUPABASE_URL, "http://stale"),
    ),
  });
  expectSuccess(run(workspace));

  const env = readEnv(workspace.envFile);
  assert.equal(env.CUSTOMER_NOTE_ENCRYPTION_KEY, CONFIGURED_NOTE_KEY);
  // Refreshed, not preserved: the stack's own values are authoritative.
  assert.equal(env.SUPABASE_URL, API_URL);
});

test("preserves a configured token-digest key instead of falling back", () => {
  const workspace = makeWorkspace({
    existingEnv: envFile(
      assign(NAME_NOTE_ENCRYPTION, CONFIGURED_NOTE_KEY),
      assign(NAME_DIGEST, CONFIGURED_DIGEST_KEY),
      assign(NAME_DIGEST_VERSION, "1"),
    ),
  });
  expectSuccess(run(workspace));

  const env = readEnv(workspace.envFile);
  assert.equal(env.TOKEN_DIGEST_KEY, CONFIGURED_DIGEST_KEY);
  // The encryption key must not be silently substituted for the digest key:
  // the two rotate on different terms.
  assert.notEqual(env.TOKEN_DIGEST_KEY, env.CUSTOMER_NOTE_ENCRYPTION_KEY);
  assert.equal(env.CUSTOMER_NOTE_ENCRYPTION_KEY, CONFIGURED_NOTE_KEY);
});

test("preserves the previous token-digest key so an in-progress rotation survives", () => {
  const workspace = makeWorkspace({
    existingEnv: envFile(
      assign(NAME_NOTE_ENCRYPTION, CONFIGURED_NOTE_KEY),
      assign(NAME_DIGEST, CONFIGURED_DIGEST_KEY),
      assign(NAME_DIGEST_PREVIOUS, CONFIGURED_PREVIOUS_DIGEST_KEY),
      assign(NAME_DIGEST_VERSION, "4"),
    ),
  });
  expectSuccess(run(workspace));

  const env = readEnv(workspace.envFile);
  assert.equal(env.TOKEN_DIGEST_KEY, CONFIGURED_DIGEST_KEY);
  assert.equal(env.TOKEN_DIGEST_KEY_PREVIOUS, CONFIGURED_PREVIOUS_DIGEST_KEY);
});

test("preserves the token-digest key version instead of resetting it to 1", () => {
  const workspace = makeWorkspace({
    existingEnv: envFile(assign(NAME_DIGEST, CONFIGURED_DIGEST_KEY), assign(NAME_DIGEST_VERSION, "7")),
  });
  expectSuccess(run(workspace));

  assert.equal(readEnv(workspace.envFile).TOKEN_DIGEST_KEY_VERSION, "7");
});

test("a repeated variable resolves to its last assignment, as dotenv does", () => {
  const workspace = makeWorkspace({
    existingEnv: envFile(
      assign(NAME_DIGEST_VERSION, "1"),
      assign(NAME_DIGEST, CONFIGURED_DIGEST_KEY),
      assign(NAME_DIGEST_VERSION, "5"),
    ),
  });
  expectSuccess(run(workspace));

  assert.equal(readEnv(workspace.envFile).TOKEN_DIGEST_KEY_VERSION, "5");
});

test("treats an empty assignment as unconfigured, the way .env.example ships it", () => {
  const workspace = makeWorkspace({
    existingEnv: envFile(
      assign(NAME_DIGEST, ""),
      assign(NAME_DIGEST_VERSION, ""),
      assign(NAME_NOTE_ENCRYPTION, ""),
    ),
  });
  expectSuccess(run(workspace));

  const env = readEnv(workspace.envFile);
  assert.equal(env.TOKEN_DIGEST_KEY, undefined);
  assert.equal(env.TOKEN_DIGEST_KEY_VERSION, "1");
  assert.equal(Buffer.from(env.CUSTOMER_NOTE_ENCRYPTION_KEY, "base64").length, 32);
});

// --------------------------------------------------------------- failure paths

test("supabase status failure prints the actionable message and writes nothing", () => {
  const original = envFile(assign(NAME_NOTE_ENCRYPTION, CONFIGURED_NOTE_KEY));
  const workspace = makeWorkspace({ status: "failure", existingEnv: original });

  const result = run(workspace);
  assert.notEqual(result.status, 0, "expected a non-zero exit");
  // The intended diagnostic must survive `set -e`, which used to abort at the
  // command assignment before this could print.
  assert.match(result.stderr, /`supabase status` failed/);
  assert.match(result.stderr, /supabase@\d+\.\d+\.\d+ start/);
  // The existing file is left exactly as it was.
  assert.equal(fs.readFileSync(workspace.envFile, "utf8"), original);
});

test("missing required values are named and abort the run", () => {
  const workspace = makeWorkspace({ status: "incomplete" });

  const result = run(workspace);
  assert.notEqual(result.status, 0, "expected a non-zero exit");
  assert.match(result.stderr, /SERVICE_ROLE_KEY/);
  assert.equal(fs.existsSync(workspace.envFile), false, "no partial file should remain");
});

test("leaves no temporary file behind when it aborts", () => {
  const workspace = makeWorkspace({ status: "failure" });
  run(workspace);

  const leftovers = fs.readdirSync(path.join(workspace.root, "frontend"));
  assert.deepEqual(leftovers, [], `unexpected files: ${leftovers.join(", ")}`);
});

// ------------------------------------------------------------------ file mode

test("enforces mode 600 even under a permissive umask", () => {
  const workspace = makeWorkspace();
  expectSuccess(run(workspace, { umask: "000" }));

  assert.equal(modeOf(workspace.envFile), "600");
});

test("tightens a pre-existing world-readable file", () => {
  const workspace = makeWorkspace({
    existingEnv: envFile(assign(NAME_NOTE_ENCRYPTION, CONFIGURED_NOTE_KEY)),
    existingEnvMode: 0o644,
  });
  assert.equal(modeOf(workspace.envFile), "644");

  expectSuccess(run(workspace, { umask: "022" }));
  assert.equal(modeOf(workspace.envFile), "600");
});

test("reports the mode it verified", () => {
  const workspace = makeWorkspace();
  const result = expectSuccess(run(workspace));

  assert.match(result.stdout, /mode 600/);
});

// ------------------------------------------------------------------ idempotence

test("rerunning is byte-for-byte idempotent", () => {
  const workspace = makeWorkspace({
    existingEnv: envFile(
      assign(NAME_NOTE_ENCRYPTION, CONFIGURED_NOTE_KEY),
      assign(NAME_DIGEST, CONFIGURED_DIGEST_KEY),
      assign(NAME_DIGEST_PREVIOUS, CONFIGURED_PREVIOUS_DIGEST_KEY),
      assign(NAME_DIGEST_VERSION, "3"),
    ),
  });

  expectSuccess(run(workspace));
  const first = fs.readFileSync(workspace.envFile, "utf8");
  expectSuccess(run(workspace));
  const second = fs.readFileSync(workspace.envFile, "utf8");

  assert.equal(second, first);
  assert.equal(modeOf(workspace.envFile), "600");
});

test("a generated file survives a rerun with every secret intact", () => {
  const workspace = makeWorkspace();
  expectSuccess(run(workspace));
  const minted = readEnv(workspace.envFile).CUSTOMER_NOTE_ENCRYPTION_KEY;

  // A developer configuring a digest key after the first run.
  const configured = randomBytes(32).toString("base64");
  fs.appendFileSync(
    workspace.envFile,
    envFile(assign(NAME_DIGEST, configured), assign(NAME_DIGEST_VERSION, "2")),
  );

  expectSuccess(run(workspace));
  const env = readEnv(workspace.envFile);
  assert.equal(env.CUSTOMER_NOTE_ENCRYPTION_KEY, minted);
  assert.equal(env.TOKEN_DIGEST_KEY, configured);
  assert.equal(env.TOKEN_DIGEST_KEY_VERSION, "2");
});

// -------------------------------------------------- committed-source guarantee

test("the environment sources contain no populated secret assignment", () => {
  // The same pattern the `secrets` job in .github/workflows/ci.yml enforces,
  // applied to this file too: a fixture written as a literal assignment would
  // fail that job just as the generator once did.
  const pattern = /(SUPABASE_SERVICE_ROLE_KEY|PII_ENCRYPTION_KEY|TOKEN_DIGEST_KEY|ENCRYPTION_KEY)=.+/;
  const files = [
    ".cursor/install.sh",
    ".cursor/start.sh",
    "scripts/dev/setup-local-env.sh",
    "scripts/dev/tool-versions.sh",
    "scripts/dev/docker-nested-vm.sh",
    "scripts/dev/__tests__/setup-local-env.test.mjs",
  ];

  for (const relative of files) {
    const lines = fs.readFileSync(path.join(REPO_ROOT, relative), "utf8").split("\n");
    lines.forEach((line, index) => {
      assert.equal(pattern.test(line), false, `${relative}:${index + 1} matches the secret scanner: ${line}`);
    });
  }
});
