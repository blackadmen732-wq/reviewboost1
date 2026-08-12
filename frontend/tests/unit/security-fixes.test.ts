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

    const required = ["/home", "/feedback", "/praise", "/stands", "/settings", "/onboarding", "/reviews", "/customers"];
    for (const prefix of required) {
      expect(source, `missing ${prefix}`).toContain(`"${prefix}"`);
    }
  });
});

describe("QR stand card security", () => {
  it("fetches QR with bearer token and credentials: omit", () => {
    const filePath = path.resolve(__dirname, "../../features/dashboard/stand-card.tsx");
    const source = fs.readFileSync(filePath, "utf-8");

    expect(source).toContain("Authorization:");
    expect(source).toContain('credentials: "omit"');
    expect(source).not.toContain("<img\n          src={qrSrc}");
    expect(source).toContain("URL.createObjectURL");
    expect(source).toContain("URL.revokeObjectURL");
  });

  it("does not use a plain anchor tag for download", () => {
    const filePath = path.resolve(__dirname, "../../features/dashboard/stand-card.tsx");
    const source = fs.readFileSync(filePath, "utf-8");

    expect(source).not.toContain('href={qrSrc}');
    expect(source).not.toContain("<a href=");
  });
});
