import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The two deletion screens, checked against each other.
 *
 * Deletion exists on the web and on the phone because both stores require it
 * to be startable from inside the app. Two implementations of an irreversible
 * action is a drift risk: the one nobody looks at grows its own endpoint, or
 * stops gating on owner, or starts sending an identity the rules forbid.
 *
 * So this asserts they agree. It lives in the frontend suite rather than the
 * mobile one because the mobile project deliberately has no Node types —
 * every test there is pure logic, and adding `@types/node` to a React Native
 * app would let somebody `import fs` in a screen and have it typecheck right
 * up until the device crashed.
 *
 * The endpoint's actual behaviour — owner only, Stripe cancelled first,
 * nothing deleted if that fails, identity never read from the body — is tested
 * in account-deletion-route.test.ts and in
 * supabase/tests/account_deletion_test.sql. Repeating it here would be theatre.
 */

const ROOT = process.cwd();
const MOBILE = join(ROOT, "..", "apps", "mobile");

const ENDPOINT = "/api/v1/account/deletion";

const web = readFileSync(join(ROOT, "features/settings/delete-account-flow.tsx"), "utf8");
const native = readFileSync(join(MOBILE, "app/delete-account.tsx"), "utf8");
const nativeAccountTab = readFileSync(join(MOBILE, "app/(tabs)/account.tsx"), "utf8");

describe("the phone and the browser delete the same way", () => {
  it("finds the mobile app where this test thinks it is", () => {
    // Otherwise a moved directory turns every assertion below into a silent
    // pass against an empty string.
    expect(existsSync(join(MOBILE, "app/delete-account.tsx"))).toBe(true);
  });

  it("call one endpoint, not one each", () => {
    expect(web).toContain(ENDPOINT);
    expect(native).toContain(ENDPOINT);
  });

  it("send only the confirmation, never an identity", () => {
    // The owner's rule: nobody types another person's address and deletes
    // their account. The defence is that the request carries no identity at
    // all, on either platform.
    for (const [name, source] of [
      ["web", web],
      ["native", native],
    ] as const) {
      const body = /body: JSON\.stringify\(([\s\S]*?)\),/.exec(source)?.[1] ?? "";
      expect(body, `${name} sends no body`).toContain("confirmation");
      expect(body, `${name} smuggles an identity`).not.toMatch(
        /email|userId|user_id|\borgId\b/,
      );
    }
  });

  it("both gate on owner", () => {
    expect(web).toMatch(/isOwner/);
    expect(native).toMatch(/role === "owner"/);
  });

  it("both require the business name typed, not a dismissible confirmation", () => {
    for (const [name, source] of [
      ["web", web],
      ["native", native],
    ] as const) {
      expect(source, `${name} does not compare a typed name`).toMatch(
        /toLowerCase\(\)\s*===/,
      );
    }
    // The shapes deliberately avoided: both are dismissed by muscle memory.
    expect(native).not.toMatch(/Alert\.alert/);
    expect(web).not.toMatch(/window\.confirm/);
  });

  it("both clear the session afterwards, because the login is usually gone", () => {
    expect(web).toMatch(/signOut\(\)/);
    expect(web).toContain("/goodbye");
    expect(native).toContain("logout()");
    expect(native).toContain('router.replace("/login")');
  });

  it("is reachable from the mobile account tab, which is what the store requires", () => {
    expect(nativeAccountTab).toContain('href="/delete-account"');
  });
});
