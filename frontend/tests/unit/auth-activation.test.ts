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

describe("login, verify, and activation chrome", () => {
  it("uses ReviewBoostLogo in auth chrome, not Wordmark", () => {
    const frame = code("features/auth/auth-frame.tsx");
    const login = code("app/(owner)/login/page.tsx");
    const onboarding = code("app/(owner)/onboarding/page.tsx");
    const signIn = code("features/auth/sign-in-flow.tsx");

    expect(frame).toContain("ReviewBoostLogo");
    expect(login).toContain("AuthFrame");
    expect(onboarding).toContain("AuthFrame");
    expect(signIn).not.toContain("Wordmark");
    expect(signIn).toContain("data-auth-step");
    expect(signIn).toContain('variant="action"');
  });

  it("keeps signed-out / as the public homepage", () => {
    const page = code("app/page.tsx");
    expect(page).toContain("PublicHome");
    expect(page).not.toMatch(/redirect\("\/login"\)/);
  });

  it("onboarding still posts to the existing API once", () => {
    const flow = code("features/onboarding/onboarding-flow.tsx");
    expect(flow).toContain("/api/v1/onboarding");
    expect(flow).toContain("data-onboarding-step");
    expect(flow).toContain("Open customer page");
    expect(flow).toContain("Print this code");
    expect(flow).toContain("Copy the tag link");
  });
});
