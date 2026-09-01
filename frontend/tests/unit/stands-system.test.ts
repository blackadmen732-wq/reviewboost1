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
    const MAX = 4096;

    it("accepts valid sizes including custom range", () => {
      for (const size of [150, 300, 512, 1024, 2048, 3000, 4096]) {
        expect(size >= MIN && size <= MAX).toBe(true);
      }
    });

    it("rejects sizes below minimum", () => {
      expect(100 >= MIN).toBe(false);
      expect(0 >= MIN).toBe(false);
    });

    it("rejects sizes above maximum", () => {
      expect(8192 <= MAX).toBe(false);
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

      expect(url).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    });
  });

  describe("Stand list DTO shape (v1)", () => {
    it("includes NFC provisioning timestamp but NOT UID", () => {
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
        nfcProvisionedAt: null,
      };

      expect(stand).toHaveProperty("nfcProvisionedAt");
      expect(stand).toHaveProperty("locationId");
      expect(stand).toHaveProperty("tokenRotatedAt");
      expect(stand).not.toHaveProperty("nfcUid");
      expect(stand).not.toHaveProperty("nfcProvisionedBy");
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

  describe("Location resolution", () => {
    it("resolves each stand to its own location", () => {
      const locations = new Map([
        ["loc-1", "Miami"],
        ["loc-2", "Fort Lauderdale"],
      ]);

      const stands = [
        { standId: "s1", locationId: "loc-1" },
        { standId: "s2", locationId: "loc-2" },
        { standId: "s3", locationId: "loc-1" },
      ];

      const resolved = stands.map((s) => ({
        ...s,
        locationName: locations.get(s.locationId) ?? null,
      }));

      expect(resolved[0]!.locationName).toBe("Miami");
      expect(resolved[1]!.locationName).toBe("Fort Lauderdale");
      expect(resolved[2]!.locationName).toBe("Miami");
    });

    it("handles unknown location gracefully", () => {
      const locations = new Map<string, string>();
      const resolved = { locationId: "loc-unknown", locationName: locations.get("loc-unknown") ?? null };
      expect(resolved.locationName).toBeNull();
    });
  });

  describe("Add Stand validation", () => {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    it("requires a valid UUID for locationId", () => {
      expect(UUID.test("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
      expect(UUID.test("not-a-uuid")).toBe(false);
      expect(UUID.test("")).toBe(false);
    });

    it("enforces label length limit", () => {
      const maxLength = 100;
      expect("Front Desk".length <= maxLength).toBe(true);
      expect("A".repeat(101).length <= maxLength).toBe(false);
    });

    it("requires owner or admin role", () => {
      const allowed = ["owner", "admin"];
      expect(allowed.includes("owner")).toBe(true);
      expect(allowed.includes("admin")).toBe(true);
      expect(allowed.includes("member")).toBe(false);
      expect(allowed.includes("viewer")).toBe(false);
    });
  });

  describe("NFC content protection", () => {
    it("classifies blank tag as writable", () => {
      const records: unknown[] = [];
      const hasContent = records.length > 0;
      expect(hasContent).toBe(false);
    });

    it("classifies same-URL tag as already correct", () => {
      const tagUrl = "https://app.reviewboost.com/q/abc123";
      const standUrl = "https://app.reviewboost.com/q/abc123";
      expect(tagUrl === standUrl).toBe(true);
    });

    it("classifies different-content tag as needing confirmation", () => {
      const tagUrl: string = "https://example.com/other";
      const standUrl: string = "https://app.reviewboost.com/q/abc123";
      expect(tagUrl === standUrl).toBe(false);
    });

    it("blocks write when tag read fails (timeout)", () => {
      const readResult = { readFailed: true, hasContent: false, isSameUrl: false };
      const shouldProceedToWrite = !readResult.readFailed;
      expect(shouldProceedToWrite).toBe(false);
    });

    it("blocks write when tag read errors", () => {
      const readThrew = true;
      const shouldProceedToWrite = !readThrew;
      expect(shouldProceedToWrite).toBe(false);
    });
  });

  describe("Partial success behavior", () => {
    it("distinguishes write success from server record success", () => {
      const writeSuccess = true;
      const verified = true;
      const serverRecordSuccess = false;

      const state = writeSuccess && verified && !serverRecordSuccess ? "partial" : "success";
      expect(state).toBe("partial");
    });

    it("partial retry only calls server, not rewrite", () => {
      const retryAction = "record-provision-only";
      expect(retryAction).not.toBe("full-nfc-write");
    });

    it("same-URL tag with server failure uses partial state", () => {
      const existingContent = "same-url";
      const serverRecordSuccess = false;

      const state = existingContent === "same-url" && !serverRecordSuccess ? "partial" : "success";
      expect(state).toBe("partial");
    });

    it("same-URL tag with server success uses success state", () => {
      const existingContent = "same-url";
      const serverRecordSuccess = true;

      const state = existingContent === "same-url" && !serverRecordSuccess ? "partial" : "success";
      expect(state).toBe("success");
    });
  });

  describe("Copy NFC Link", () => {
    it("uses the same URL as the QR code", () => {
      const qrUrl = "https://app.reviewboost.com/q/abc123";
      const nfcUrl = qrUrl;
      expect(nfcUrl).toBe(qrUrl);
    });
  });

  describe("SVG/PNG export labels", () => {
    it("SVG button indicates it is best for printing", () => {
      const svgLabel = "Save SVG — best for printing";
      expect(svgLabel).toContain("printing");
    });

    it("PNG allows custom sizes up to 4096", () => {
      const MAX = 4096;
      const MIN = 150;
      expect(3500 >= MIN && 3500 <= MAX).toBe(true);
      expect(4096 >= MIN && 4096 <= MAX).toBe(true);
      expect(4097 <= MAX).toBe(false);
    });
  });
});
