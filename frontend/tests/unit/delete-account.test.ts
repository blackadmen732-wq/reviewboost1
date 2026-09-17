import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PUBLIC_FOOTER } from "@/features/public/public-copy";
import { PUBLIC_ROUTES } from "@/lib/site";

/**
 * Account deletion has to be findable by somebody who cannot sign in.
 *
 * That is the whole reason both app stores require a public URL for it: the
 * person who most needs the page is often the person who has already lost
 * access, and a link buried in Settings is useless to them.
 *
 * It also has to be honest. A deletion page is the last place to describe a
 * feature optimistically, so this asserts it promises no self-service button
 * that does not exist and no timeframe nobody has agreed to.
 */

const ROOT = process.cwd();

const page = readFileSync(join(ROOT, "app/(public)/delete-account/page.tsx"), "utf8")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\s+/g, " ");

const settings = readFileSync(join(ROOT, "app/(owner)/settings/page.tsx"), "utf8");

describe("the deletion page is reachable without an account", () => {
  it("is a public route, indexed and in the sitemap", () => {
    expect(PUBLIC_ROUTES as readonly string[]).toContain("/delete-account");
  });

  it("is in the footer, where somebody locked out will look", () => {
    expect(PUBLIC_FOOTER.map((item) => item.href)).toContain("/delete-account");
  });

  it("is what Settings links to, rather than a bare mail client", () => {
    // Deletion is irreversible and takes the Tags on the counter with it.
    // Opening a pre-filled email skips the part that says so.
    expect(settings).toContain('href="/delete-account"');
  });
});

describe("the deletion page is honest", () => {
  it("promises no self-service button, because there is not one", () => {
    expect(page).not.toMatch(/delete my account now|click (here )?to delete|delete button/i);
    expect(page).toContain("privacy@reviewboost.fit");
  });

  it("promises no timeframe", () => {
    expect(page).not.toMatch(/within \d+ (day|hour|business)/i);
  });

  it("says deletion is irreversible and not the way to pause", () => {
    expect(page.toLowerCase()).toContain("cannot be undone");
    expect(page.toLowerCase()).toContain("not the way to pause");
  });

  it("warns that the Tags on the counter stop working", () => {
    // The consequence somebody will not think of until a customer scans a dead
    // code.
    expect(page.toLowerCase()).toContain("they stop working");
  });

  it("tells somebody to cancel the subscription themselves first", () => {
    expect(page.toLowerCase()).toContain("cancel it first");
  });

  it("requires the request to come from the account's own address", () => {
    // Otherwise anyone who knows an email address can ask for that account to
    // be destroyed.
    expect(page.toLowerCase()).toContain("from the address you signed in with");
  });
});
