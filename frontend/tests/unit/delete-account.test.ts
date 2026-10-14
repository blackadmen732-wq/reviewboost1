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
 * It also has to be honest. Three assertions here used to pin the opposite
 * product — "promises no self-service button, because there is not one",
 * "tells somebody to cancel the subscription themselves first", and Settings
 * linking to this page rather than to a deletion screen. All three were true
 * of a mailto, and all three failed the moment deletion became something the
 * app does. That is the failure working: they now pin the new behaviour, and
 * the honesty rule is unchanged — describe what happens, not what would be
 * nice.
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

  it("is not what Settings links to, because Settings can do it", () => {
    // A person who is signed in should not be sent to a public page to read
    // about asking. The public page is for the person who cannot sign in.
    expect(settings).toContain('href="/settings/delete"');
    expect(settings).not.toContain('href="/delete-account"');
    expect(settings).not.toMatch(/mailto:[^"]*delete/i);
  });
});

describe("the deletion page is honest", () => {
  it("names the in-app route, because there is one now", () => {
    expect(page).toContain("/settings/delete");
    expect(page.toLowerCase()).toContain("type your business name to confirm");
  });

  it("keeps email as the route for somebody locked out", () => {
    // The person who most needs this page is often the person who can no
    // longer sign in, and "use Settings" is useless to them.
    expect(page).toContain("privacy@reviewboost.fit");
    expect(page.toLowerCase()).toContain("if you cannot sign in");
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

  it("says the deletion cancels the subscription, because it does", () => {
    // The route cancels in Stripe before it deletes, and refuses to delete at
    // all if that fails. Telling someone to cancel first would now be asking
    // for a step the product already takes.
    expect(page.toLowerCase()).not.toContain("cancel it first");
    expect(page.toLowerCase()).toContain("deleting cancels it");
  });

  it("requires the request to come from the account's own address", () => {
    // Otherwise anyone who knows an email address can ask for that account to
    // be destroyed.
    expect(page.toLowerCase()).toContain("from the address you signed in with");
  });
});
