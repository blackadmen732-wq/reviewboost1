import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PRODUCT } from "@/features/public/public-copy";

/**
 * The Product page explains the one thing about Tags an owner has to get right:
 * what breaks a printed code and what does not.
 *
 * Both claims were checked against the database before being written.
 *
 * Changing the Google destination does not break a code, because the Tag holds
 * a ReviewBoost address and never the destination.
 *
 * Rotating does break it, because `rpc_rotate_stand_token` replaces
 * `public_token_hash` outright. The resolver does accept a
 * `p_previous_token_hash`, which looks like a contradiction until you read what
 * it is for — the same token re-hashed under a previous *digest key*, the lazy
 * upgrade path for `TOKEN_DIGEST_KEY_PREVIOUS`. Not a previous token. Getting
 * those two confused would have put a false reassurance on the page.
 */

const ROOT = process.cwd();

const page = readFileSync(join(ROOT, "app/(public)/product/page.tsx"), "utf8")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\s+/g, " ");

function migrations(): string {
  const dir = join(ROOT, "..", "supabase/migrations");
  return readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => readFileSync(join(dir, file), "utf8"))
    .join("\n");
}

describe("the Product page tells the truth about Tags", () => {
  it("says the code holds a ReviewBoost address, never the destination", () => {
    expect(page.toLowerCase()).toContain("never to google");
  });

  it("says changing the Google link leaves the Tag alone", () => {
    expect(page.toLowerCase()).toContain("changing your google link does not");
  });

  it("says rotation does break printed copies — because it replaces the token", () => {
    // The claim is only safe because rotation overwrites the hash rather than
    // keeping the old one alongside it.
    expect(migrations()).toMatch(/set\s+public_token_hash\s*=\s*p_new_token_hash/);
    expect(page.toLowerCase()).toContain("stops working");
  });

  it("tells somebody to print the replacement before retiring the original", () => {
    // Rotating first and printing second means a dead code on the counter for
    // however long the printer takes.
    expect(page.toLowerCase()).toContain("print the replacement before");
  });
});

describe("the product copy uses the product's own words", () => {
  it("capitalises Tag, because that is the product noun", () => {
    const items = PRODUCT.items.map((item) => item.title).join(" ");
    expect(items).not.toMatch(/\btag\b/);
    expect(items).toMatch(/\bTag\b/);
  });

  it("never says Stand", () => {
    expect(page).not.toMatch(/\bstand(s)?\b/i);
  });
});
