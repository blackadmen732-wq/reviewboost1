import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("owner empty, error, offline, permission language", () => {
  it("empty states name the cause, not a void", () => {
    const home = code("features/dashboard/owner-home.tsx");
    const tags = code("app/(owner)/stands/page.tsx");
    const feedback = code("app/(owner)/feedback/page.tsx");

    expect(home).toContain("No ratings yet.");
    expect(home).toContain("Your tag is ready. Put it where people pay.");
    expect(tags).toContain("No tags yet");
    expect(tags).toContain("Create a Tag, print the code");
    expect(feedback).toContain("All caught up");
    expect(feedback).toContain("Nothing yet");
  });

  it("errors say what is happening, try again by themselves, and do not dump the exception", () => {
    const owner = code("app/(owner)/error.tsx");
    const ownerMissing = code("app/(owner)/not-found.tsx");
    const publicError = code("app/error.tsx");
    const words = code("lib/recovery/words.ts");

    // The words live in one place; both pages count down with the same hook.
    expect(owner).toContain("useAutoRetry");
    expect(owner).toContain("retryCopy");
    expect(owner).toContain("OwnerShell");
    expect(owner).not.toMatch(/error\.message|stack|Something went wrong/i);
    expect(ownerMissing).toContain("We could not find that");
    expect(publicError).toContain("useAutoRetry");
    expect(publicError).not.toMatch(/error\.message|Something went wrong/i);
    expect(words).toContain("That didn’t load");
    expect(words).toContain("Try now");
    expect(words).toContain("Try again");
    expect(words).not.toMatch(/Something went wrong/i);
  });

  it("never asks the owner to go and check whether something went through", () => {
    // The app checks for itself (useOutcomeCheck) and says what it found.
    const files = [
      "features/customer-page/customer-page-editor.tsx",
      "features/settings/delete-account-flow.tsx",
      "features/settings/personal-deletion-flow.tsx",
      "features/settings/add-location-button.tsx",
      "features/dashboard/settings-form.tsx",
      "features/dashboard/action-thread.tsx",
      "features/dashboard/add-stand-button.tsx",
      "features/dashboard/resolve-button.tsx",
      "features/dashboard/text-request-composer.tsx",
      "features/tags/tag-detail.tsx",
      "lib/api/read-deadline.ts",
      "lib/recovery/words.ts",
      "app/offline/page.tsx",
    ];
    for (const file of files) {
      expect(code(file), file).not.toMatch(
        /before trying again|before adding another|before creating another|before sending it again|Check Recent|Check this Tag|Check your (Tags|places|businesses)|Check the (published page|feedback status|saved notes)|check the current value|Reload (this page )?to check|check pending/i,
      );
    }
  });

  it("offline names the connection, not a broken app", () => {
    const offline = code("app/offline/page.tsx");
    expect(offline).toContain("You are offline");
    expect(offline).toContain("Check your connection");
    expect(offline).not.toMatch(/Something went wrong/i);
  });

  /**
   * This read `features/dashboard/web-nfc-writer.tsx`, which was imported only
   * by `features/dashboard/stand-card.tsx`, which nothing rendered. Both are
   * gone.
   *
   * It is worth saying what the dead file cost, because it was not only
   * wasted: one assertion here was `expect(nfc).not.toMatch(/couldn'?t/i)`,
   * banning a contraction. The live NFC flow says "Couldn't read this Tag" —
   * that exact wording was specified when the flow was simplified. So a green
   * test was enforcing a rule the product had overruled, against a file no
   * user could reach. Anyone reading the suite would have believed the ban
   * held.
   *
   * The copy now lives in one place, `lib/owner/nfc-presentation.ts`, shared
   * by the web sheet and mirrored on native.
   */
  it("permission copy is human and does not invent a reason", () => {
    const auth = code("lib/server/auth.ts");
    const nfc = code("lib/owner/nfc-presentation.ts");

    expect(auth).toContain("You do not have permission to do that.");

    // The three moments that need a human decision, in the words the flow uses.
    expect(nfc).toMatch(/Couldn[’']t read this Tag/);
    expect(nfc).toContain("Try again");
    expect(nfc).toContain("This Tag already has something on it");
    expect(nfc).toContain("Replacing it will erase what is there.");
    expect(nfc).toContain("Your Tag works");
    expect(nfc).toContain("Finish setup");

    // No hardware vocabulary, and no fake precision about proximity: NFC
    // reports no distance, so nothing may claim one.
    expect(nfc).not.toMatch(/NTAG\d/);
    expect(nfc).not.toMatch(/\bNDEF\b/);
    expect(nfc).not.toMatch(/\bcm\b|centimet|inches away|getting closer/i);
  });
});
