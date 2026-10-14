import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import robots from "@/app/robots";

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
    expect(page).toContain("catch");
    expect(page).toContain("signedIn");
  });

  it("Get started and Sign in are the same OTP door with different copy", () => {
    const login = code("app/(owner)/login/page.tsx");
    const signIn = code("features/auth/sign-in-flow.tsx");
    expect(login).toContain("isGetStartedNext");
    expect(signIn).toContain('intent === "start" ? "Get started" : "Sign in"');
  });

  /**
   * Asserted against the rules the function returns, not the text of the file.
   * The previous version matched a literal `allow: ["/", "/how-it-works"`, so
   * reformatting the array broke it while the behaviour was unchanged — and it
   * would equally have passed on a list that had stopped being true.
   */
  it("keeps crawlers off owner, login, and customer tokens", () => {
    const { rules } = robots() as {
      rules: { allow: string[]; disallow: string[] };
    };

    // The public site is meant to be found, the legal pages included.
    for (const path of [
      "/",
      "/how-it-works",
      "/product",
      "/integrity",
      "/pricing",
      "/security",
      "/privacy",
      "/terms",
      "/support",
    ]) {
      expect(rules.allow).toContain(path);
    }

    // Owner screens, the auth flow, customer tokens and the API are not.
    for (const path of [
      "/home",
      "/feedback",
      "/stands",
      "/text-requests",
      "/customer-page",
      "/settings",
      "/select-org",
      "/login",
      "/onboarding",
      "/q/",
      "/api/",
    ]) {
      expect(rules.disallow).toContain(path);
    }

    // Nothing may be both.
    expect(rules.allow.filter((path) => rules.disallow.includes(path))).toEqual([]);
  });

  it("onboarding still posts to the existing API once", () => {
    const flow = code("features/onboarding/onboarding-flow.tsx");
    expect(flow).toContain("/api/v1/onboarding");
    expect(flow).toContain("data-onboarding-step");
    expect(flow).toContain("Print this code");
    // Setting up is free; serving customers is what needs a plan.
    expect(flow).toContain("Choose a plan to switch it on");
  });
});
