import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

/**
 * Pages must refuse to be framed. API routes are excluded from this rule on
 * purpose: `lib/server/http.ts` gives them a stricter policy of their own, and
 * two Content-Security-Policy headers on one response are intersected, not
 * replaced.
 */
async function pageRule() {
  const rules = (await nextConfig.headers?.()) ?? [];
  expect(rules).toHaveLength(1);
  return rules[0]!;
}

function matches(source: string, path: string): boolean {
  return new RegExp(`^${source}$`).test(path);
}

describe("page security headers", () => {
  it("forbids framing on every page", async () => {
    const rule = await pageRule();
    const byKey = new Map(rule.headers.map(({ key, value }) => [key, value]));

    expect(byKey.get("X-Frame-Options")).toBe("DENY");
    expect(byKey.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(byKey.get("X-Content-Type-Options")).toBe("nosniff");
    expect(byKey.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("covers owner, public and customer pages", async () => {
    const { source } = await pageRule();
    for (const path of ["/", "/settings", "/settings/delete", "/q/AbCdEf123", "/pricing"]) {
      expect(matches(source, path), path).toBe(true);
    }
  });

  it("leaves API routes to their own stricter headers", async () => {
    const { source } = await pageRule();
    expect(matches(source, "/api/v1/settings")).toBe(false);
    expect(matches(source, "/api/v1/public/q/AbCdEf123")).toBe(false);
  });
});
