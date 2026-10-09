import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("public customer API credentials", () => {
  it("uses credentials: omit, never include", () => {
    const filePath = path.resolve(__dirname, "../../lib/api/production-customer-flow-api.ts");
    const source = fs.readFileSync(filePath, "utf-8");

    expect(source).toContain('credentials: "omit"');
    expect(source).not.toContain('credentials: "include"');
    expect(source).not.toContain("credentials: 'include'");
  });
});

describe("owner route protection", () => {
  it("includes /reviews and /customers in OWNER_PREFIXES", () => {
    const filePath = path.resolve(__dirname, "../../proxy.ts");
    const source = fs.readFileSync(filePath, "utf-8");

    expect(source).toContain('"/reviews"');
    expect(source).toContain('"/customers"');
  });

  it("protects all known owner routes", () => {
    const filePath = path.resolve(__dirname, "../../proxy.ts");
    const source = fs.readFileSync(filePath, "utf-8");

    const required = ["/home", "/feedback", "/praise", "/stands", "/settings", "/onboarding", "/reviews", "/customers", "/select-org"];
    for (const prefix of required) {
      expect(source, `missing ${prefix}`).toContain(`"${prefix}"`);
    }
  });
});

/**
 * A Tag's QR is not public. It is fetched with the owner's bearer token and
 * held as an object URL, so it never becomes a plain `<img src>` or an anchor
 * that a browser would fetch without credentials — and, worse, that a referrer
 * or a shared screenshot of the URL bar would leak.
 *
 * Both assertions below used to read `features/dashboard/stand-card.tsx`,
 * which nothing renders. The Tag detail page mounts
 * `features/tags/tag-detail.tsx`; stand-card was the previous implementation
 * and has been removed. A security test pointed at dead code is the worst
 * shape a test can take: it is green, it names a real property, and it is
 * checking a file that could not fail in production because it never runs.
 */
describe("QR security on the Tag surface", () => {
  const detailPath = path.resolve(__dirname, "../../features/tags/tag-detail.tsx");

  it("fetches QR with bearer token and credentials: omit", () => {
    const hookPath = path.resolve(__dirname, "../../lib/hooks/use-authenticated-qr.ts");
    const hookSource = fs.readFileSync(hookPath, "utf-8");

    expect(hookSource).toContain("Authorization:");
    expect(hookSource).toContain('credentials: "omit"');
    expect(hookSource).toContain("URL.createObjectURL");
    expect(hookSource).toContain("URL.revokeObjectURL");

    const detail = fs.readFileSync(detailPath, "utf-8");

    expect(detail).toContain("useAuthenticatedQr");
    // The token-bearing URL must never be handed to the browser to fetch.
    expect(detail).not.toMatch(/<img[^>]*src=\{`?\/api\/v1\/review-stands/);
  });

  it("does not use a plain anchor tag for download", () => {
    const detail = fs.readFileSync(detailPath, "utf-8");

    expect(detail).not.toContain("href={qrSrc}");
    expect(detail).not.toMatch(/<a\s+href=\{`?\/api\/v1/);
  });

  it("is checking a file that is actually rendered", () => {
    // The whole point of moving these assertions. If the Tag detail page stops
    // mounting this component, the two tests above go back to guarding nothing
    // and this one says so.
    const page = fs.readFileSync(
      path.resolve(__dirname, "../../app/(owner)/stands/[standId]/page.tsx"),
      "utf-8",
    );
    expect(page).toContain("features/tags/tag-detail");
    expect(page).toContain("<TagDetail");
  });
});
