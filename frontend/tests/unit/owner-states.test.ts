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
    expect(tags).toContain("Create a tag, print the code");
    expect(feedback).toContain("All caught up");
    expect(feedback).toContain("Nothing yet");
  });

  it("errors say what to do and do not dump the exception", () => {
    const owner = code("app/(owner)/error.tsx");
    const ownerMissing = code("app/(owner)/not-found.tsx");
    const publicError = code("app/error.tsx");

    expect(owner).toContain("That did not work");
    expect(owner).toContain("Try again");
    expect(owner).toContain("OwnerShell");
    expect(owner).not.toMatch(/error\.message|stack|Something went wrong/i);
    expect(ownerMissing).toContain("We could not find that");
    expect(publicError).toContain("That did not work");
    expect(publicError).not.toMatch(/error\.message|Something went wrong/i);
  });

  it("offline names the connection, not a broken app", () => {
    const offline = code("app/offline/page.tsx");
    expect(offline).toContain("You are offline");
    expect(offline).toContain("Check your connection");
    expect(offline).not.toMatch(/Something went wrong/i);
  });

  it("permission copy is human and does not invent a reason", () => {
    const auth = code("lib/server/auth.ts");
    const nfc = code("features/dashboard/web-nfc-writer.tsx");

    expect(auth).toContain("You do not have permission to do that.");
    expect(nfc).toContain("This phone did not allow tagging. Allow it and try again.");
    expect(nfc).toContain("Could not read this tag. Try again, or use a blank one.");
    expect(nfc).not.toMatch(/couldn'?t/i);
    expect(nfc).not.toMatch(/NTAG\d/);
  });
});
