import { describe, expect, it } from "vitest";
import type { StandItem } from "../types";

describe("StandItem type shape", () => {
  it("carries NFC provisioning fields", () => {
    const stand: StandItem = {
      standId: "stand-1",
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

    expect(stand.standId).toBe("stand-1");
    expect(stand.nfcProvisionedAt).toBeNull();
  });

  it("supports physical_nfc stand type", () => {
    const stand: StandItem = {
      standId: "stand-2",
      locationId: "loc-1",
      label: "Table NFC",
      standType: "physical_nfc",
      status: "active",
      tokenPrefix: "efgh",
      createdAt: "2026-08-01T00:00:00Z",
      lastOpenedAt: null,
      tokenRotatedAt: null,
      nfcProvisionedAt: "2026-08-15T10:00:00Z",
    };

    expect(stand.standType).toBe("physical_nfc");
    expect(stand.nfcProvisionedAt).not.toBeNull();
  });
});

describe("Token rotation awareness for NFC", () => {
  it("detects stale NFC tag", () => {
    const nfcProvisionedAt = "2026-08-20T10:00:00Z";
    const tokenRotatedAt = "2026-08-25T10:00:00Z";

    const needsRewrite =
      tokenRotatedAt !== null &&
      new Date(tokenRotatedAt) > new Date(nfcProvisionedAt);

    expect(needsRewrite).toBe(true);
  });

  it("NFC tag is current when provisioned after rotation", () => {
    const nfcProvisionedAt = "2026-08-25T10:00:00Z";
    const tokenRotatedAt = "2026-08-20T10:00:00Z";

    const needsRewrite =
      tokenRotatedAt !== null &&
      new Date(tokenRotatedAt) > new Date(nfcProvisionedAt);

    expect(needsRewrite).toBe(false);
  });
});
