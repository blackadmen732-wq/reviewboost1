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
    const filePath = path.resolve(__dirname, "../../lib/supabase/proxy-guard.ts");
    const source = fs.readFileSync(filePath, "utf-8");

    expect(source).toContain('"/reviews"');
    expect(source).toContain('"/customers"');
  });

  it("protects all known owner routes", () => {
    const filePath = path.resolve(__dirname, "../../lib/supabase/proxy-guard.ts");
    const source = fs.readFileSync(filePath, "utf-8");

    const required = ["/home", "/feedback", "/praise", "/stands", "/settings", "/onboarding", "/reviews", "/customers", "/select-org"];
    for (const prefix of required) {
      expect(source, `missing ${prefix}`).toContain(`"${prefix}"`);
    }
  });

  it("does not skip the owner gate when Supabase env is missing", () => {
    const proxy = fs.readFileSync(path.resolve(__dirname, "../../proxy.ts"), "utf-8");
    const guard = fs.readFileSync(path.resolve(__dirname, "../../lib/supabase/proxy-guard.ts"), "utf-8");

    // The rejected preview "fix" returned NextResponse.next() as soon as env
    // was absent, leaving OWNER_PREFIXES unsigned. Fail closed instead.
    expect(proxy).not.toMatch(/if\s*\(\s*!url\s*\|\|\s*!key\s*\)\s*\{\s*return\s+(response|finalResponse)/);
    expect(guard).toContain('action: "unavailable"');
    expect(proxy).toContain("unavailable");
    expect(proxy).toContain("503");
  });
});

describe("QR stand card security", () => {
  it("fetches QR with bearer token and credentials: omit", () => {
    const hookPath = path.resolve(__dirname, "../../lib/hooks/use-authenticated-qr.ts");
    const hookSource = fs.readFileSync(hookPath, "utf-8");

    expect(hookSource).toContain("Authorization:");
    expect(hookSource).toContain('credentials: "omit"');
    expect(hookSource).toContain("URL.createObjectURL");
    expect(hookSource).toContain("URL.revokeObjectURL");

    const cardPath = path.resolve(__dirname, "../../features/dashboard/stand-card.tsx");
    const cardSource = fs.readFileSync(cardPath, "utf-8");

    expect(cardSource).toContain("useAuthenticatedQr");
    expect(cardSource).not.toContain("<img\n          src={qrSrc}");
  });

  it("does not use a plain anchor tag for download", () => {
    const filePath = path.resolve(__dirname, "../../features/dashboard/stand-card.tsx");
    const source = fs.readFileSync(filePath, "utf-8");

    expect(source).not.toContain('href={qrSrc}');
    expect(source).not.toContain("<a href=");
  });
});
