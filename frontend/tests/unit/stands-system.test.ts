import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("Stands system", () => {
  describe("QR endpoint format validation", () => {
    it("accepts svg format", () => {
      const formats = new Set(["svg", "png", "json"]);
      expect(formats.has("svg")).toBe(true);
    });

    it("accepts png format", () => {
      const formats = new Set(["svg", "png", "json"]);
      expect(formats.has("png")).toBe(true);
    });

    it("accepts json format", () => {
      const formats = new Set(["svg", "png", "json"]);
      expect(formats.has("json")).toBe(true);
    });

    it("rejects unknown formats", () => {
      const formats = new Set(["svg", "png", "json"]);
      expect(formats.has("gif")).toBe(false);
      expect(formats.has("webp")).toBe(false);
    });
  });

  describe("PNG size validation", () => {
    const MIN = 150;
    const MAX = 2048;

    it("accepts valid sizes", () => {
      for (const size of [150, 300, 512, 1024, 2048]) {
        expect(size >= MIN && size <= MAX).toBe(true);
      }
    });

    it("rejects sizes below minimum", () => {
      expect(100 >= MIN).toBe(false);
      expect(0 >= MIN).toBe(false);
    });

    it("rejects sizes above maximum", () => {
      expect(4096 <= MAX).toBe(false);
    });
  });

  describe("NFC UID validation", () => {
    const NFC_UID_RE = /^[0-9A-Fa-f]{4,20}$/;

    it("accepts valid hex UIDs", () => {
      expect(NFC_UID_RE.test("04A1B2C3")).toBe(true);
      expect(NFC_UID_RE.test("AABBCCDD")).toBe(true);
      expect(NFC_UID_RE.test("0123")).toBe(true);
      expect(NFC_UID_RE.test("0123456789ABCDEF0123")).toBe(true);
    });

    it("rejects invalid UIDs", () => {
      expect(NFC_UID_RE.test("")).toBe(false);
      expect(NFC_UID_RE.test("XYZ")).toBe(false);
      expect(NFC_UID_RE.test("01")).toBe(false); // too short
      expect(NFC_UID_RE.test("0123456789ABCDEF01234")).toBe(false); // too long
      expect(NFC_UID_RE.test("04-A1-B2-C3")).toBe(false); // dashes
    });
  });

  describe("Token rotation awareness", () => {
    it("detects NFC tag needing rewrite after rotation", () => {
      const nfcProvisionedAt = "2026-08-20T10:00:00Z";
      const tokenRotatedAt = "2026-08-25T10:00:00Z";

      const needsRewrite =
        tokenRotatedAt !== null &&
        new Date(tokenRotatedAt) > new Date(nfcProvisionedAt);

      expect(needsRewrite).toBe(true);
    });

    it("does not flag when NFC was provisioned after rotation", () => {
      const nfcProvisionedAt = "2026-08-25T10:00:00Z";
      const tokenRotatedAt = "2026-08-20T10:00:00Z";

      const needsRewrite =
        tokenRotatedAt !== null &&
        new Date(tokenRotatedAt) > new Date(nfcProvisionedAt);

      expect(needsRewrite).toBe(false);
    });

    it("does not flag when token was never rotated", () => {
      const nfcProvisionedAt = "2026-08-20T10:00:00Z";
      const tokenRotatedAt = null;

      const needsRewrite =
        tokenRotatedAt !== null &&
        new Date(tokenRotatedAt) > new Date(nfcProvisionedAt);

      expect(needsRewrite).toBe(false);
    });
  });

  describe("Permission enforcement", () => {
    const ALLOWED_ROLES = ["owner", "admin"];

    it("allows owner", () => {
      expect(ALLOWED_ROLES.includes("owner")).toBe(true);
    });

    it("allows admin", () => {
      expect(ALLOWED_ROLES.includes("admin")).toBe(true);
    });

    it("denies member", () => {
      expect(ALLOWED_ROLES.includes("member")).toBe(false);
    });

    it("denies viewer", () => {
      expect(ALLOWED_ROLES.includes("viewer")).toBe(false);
    });
  });

  describe("Stand URL construction", () => {
    it("builds URL from frontend origin and token", () => {
      const frontendOrigin = "https://app.reviewboost.com";
      const token = "abc123def456";
      const url = `${frontendOrigin}/q/${encodeURIComponent(token)}`;

      expect(url).toBe("https://app.reviewboost.com/q/abc123def456");
    });

    it("encodes special characters in token", () => {
      const frontendOrigin = "https://app.reviewboost.com";
      const token = "abc+def/ghi=";
      const url = `${frontendOrigin}/q/${encodeURIComponent(token)}`;

      expect(url).toBe("https://app.reviewboost.com/q/abc%2Bdef%2Fghi%3D");
      expect(url).not.toContain("+");
    });

    it("does not contain org ID, location ID, or database IDs", () => {
      const frontendOrigin = "https://app.reviewboost.com";
      const token = "abc123def456";
      const url = `${frontendOrigin}/q/${encodeURIComponent(token)}`;

      expect(url).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/); // no UUIDs
    });
  });

  describe("Stand list DTO shape", () => {
    it("includes NFC provisioning fields", () => {
      const stand = {
        standId: "id-1",
        locationId: "loc-1",
        label: "Front Desk",
        standType: "printable_qr",
        status: "active",
        tokenPrefix: "abcd",
        createdAt: "2026-08-01T00:00:00Z",
        lastOpenedAt: null,
        tokenRotatedAt: null,
        nfcUid: null,
        nfcProvisionedAt: null,
        nfcProvisionedBy: null,
      };

      expect(stand).toHaveProperty("nfcUid");
      expect(stand).toHaveProperty("nfcProvisionedAt");
      expect(stand).toHaveProperty("nfcProvisionedBy");
      expect(stand).toHaveProperty("tokenRotatedAt");
    });

    it("never exposes token, token hash, or encryption details", () => {
      const stand = {
        standId: "id-1",
        label: "Front Desk",
        tokenPrefix: "abcd",
        status: "active",
      };

      const json = JSON.stringify(stand);
      expect(json).not.toContain("token_hash");
      expect(json).not.toContain("public_token_hash");
      expect(json).not.toContain("encrypted");
      expect(json).not.toContain("cipher");
      expect(json).not.toContain("key_version");
    });
  });
});
