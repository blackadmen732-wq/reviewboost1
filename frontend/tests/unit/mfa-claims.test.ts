import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * No second-factor claim without a second factor.
 *
 * Supabase Auth's TOTP and phone MFA are switched off in supabase/config.toml
 * and nothing checks for an `aal2` session, so no screen, store listing or
 * user-facing document may say an account is protected by MFA / 2FA / an
 * authenticator app. When MFA is actually built — enrollment plus a
 * server-side `aal2` check on the sensitive routes — turning the config on
 * lifts this check, and the copy can follow.
 */

const REPO = join(process.cwd(), "..");

function totpEnabled(): boolean {
  const config = readFileSync(join(REPO, "supabase", "config.toml"), "utf8");
  const section = config.split("[auth.mfa.totp]")[1]?.split(/\n\[/)[0] ?? "";
  return /^\s*verify_enabled\s*=\s*true/m.test(section);
}

function files(dir: string, pattern: RegExp): string[] {
  const base = join(REPO, dir);
  try {
    return readdirSync(base, { recursive: true, encoding: "utf8" })
      .filter((entry) => pattern.test(entry) && !entry.includes("node_modules"))
      .map((entry) => join(base, entry));
  } catch {
    return [];
  }
}

const CLAIM = /\b(multi[- ]factor|two[- ]factor|2fa|mfa|authenticator app|totp|second factor)\b/i;

describe("second-factor claims", () => {
  it("appear nowhere a person reads while MFA is disabled", () => {
    if (totpEnabled()) return;

    const readable = [
      ...files("frontend/app", /\.tsx$/),
      ...files("frontend/features", /\.tsx?$/),
      ...files("frontend/components", /\.tsx$/),
      ...files("apps/mobile/app", /\.tsx$/),
      ...files("docs/app-store", /\.(md|txt|json)$/),
      ...files("docs/google-play", /\.(md|txt|json)$/),
    ];

    const offenders = readable.filter((path) => {
      // Comments are for engineers, not claims to customers.
      const text = readFileSync(path, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      return CLAIM.test(text);
    });

    expect(offenders).toEqual([]);
  });
});
