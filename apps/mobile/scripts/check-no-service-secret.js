#!/usr/bin/env node
// Fail if a Supabase service-role JWT (or any JWT whose payload claims an
// elevated role) is committed anywhere under apps/mobile.
//
// The name-based scans in the workflow catch obvious cases (a
// SUPABASE_SERVICE_ROLE_KEY assignment, or a secret under an EXPO_PUBLIC_*
// name). They do NOT catch a service-role JWT accidentally pasted into the
// legitimate, innocuously named EXPO_PUBLIC_SUPABASE_ANON_KEY — the anon and
// service-role keys are both JWTs and look alike. This project has already
// had a live key pasted into the wrong variable once, so this guard decodes
// every JWT-shaped value and rejects any whose payload is privileged.
//
// Dependency-free (Node builtins only) so it runs without `npm ci`.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

// Tracked files under apps/mobile, excluding docs/examples (those legitimately
// name the risk in prose) and obvious binaries.
const files = execFileSync("git", ["ls-files", "apps/mobile"], {
  encoding: "utf8",
  cwd: repoRoot,
})
  .split("\n")
  .filter(Boolean)
  .filter((f) => !/\.(md|png|jpg|jpeg|gif|webp|ico|lock)$/i.test(f))
  .filter((f) => !f.endsWith(".example"));

// header.payload.signature — base64url segments.
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g;
const PRIVILEGED_ROLES = new Set(["service_role", "supabase_admin", "postgres"]);

const problems = [];

for (const rel of files) {
  const abs = path.join(repoRoot, rel);
  let text;
  try {
    text = fs.readFileSync(abs, "utf8");
  } catch {
    continue;
  }
  const matches = text.match(JWT_RE);
  if (!matches) continue;
  for (const jwt of matches) {
    const payloadB64 = jwt.split(".")[1];
    let claims;
    try {
      claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    } catch {
      continue; // not a decodable JWT payload; ignore
    }
    if (claims && typeof claims.role === "string" && PRIVILEGED_ROLES.has(claims.role)) {
      problems.push(`${rel}: committed JWT has privileged role "${claims.role}"`);
    }
  }
}

if (problems.length) {
  console.error(
    `::error::privileged Supabase JWT committed under apps/mobile: ${problems.join(" | ")}`,
  );
  process.exit(1);
}
console.log(`Scanned ${files.length} mobile files: no privileged JWT committed.`);
