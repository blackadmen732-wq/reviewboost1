import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const KEY = Buffer.alloc(32, 9).toString("base64");
beforeAll(() => {
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = KEY;
});

const load = () => import("@/lib/server/sms/phone");

describe("phone normalization", () => {
  it("accepts an E.164 number unchanged", async () => {
    const { normalizePhone } = await load();
    expect(normalizePhone("+15551234567")).toEqual({ e164: "+15551234567", lastFour: "4567" });
  });

  it("strips visual separators", async () => {
    const { normalizePhone } = await load();
    expect(normalizePhone("+1 (555) 123-4567").e164).toBe("+15551234567");
    expect(normalizePhone("+1.555.123.4567").e164).toBe("+15551234567");
  });

  it("converts the 00 international access prefix", async () => {
    const { normalizePhone } = await load();
    expect(normalizePhone("0044 7911 123456").e164).toBe("+447911123456");
  });

  it("applies a default country calling code to a national number", async () => {
    const { normalizePhone } = await load();
    expect(normalizePhone("(555) 123-4567", { defaultCountryCallingCode: "1" }).e164).toBe(
      "+15551234567",
    );
    // A single national trunk 0 is dropped.
    expect(normalizePhone("07911123456", { defaultCountryCallingCode: "44" }).e164).toBe(
      "+447911123456",
    );
  });

  it("rejects rather than guesses malformed input", async () => {
    const { normalizePhone, PhoneNormalizationError } = await load();
    for (const bad of ["hello", "12345", "+0123456789", "+1555abc4567", ""]) {
      expect(() => normalizePhone(bad)).toThrow(PhoneNormalizationError);
    }
  });

  it("does not apply a country code to a number that already has one", async () => {
    const { normalizePhone } = await load();
    expect(normalizePhone("+447911123456", { defaultCountryCallingCode: "1" }).e164).toBe(
      "+447911123456",
    );
  });
});

describe("phone storage identity", () => {
  it("hashes deterministically and reveals nothing", async () => {
    const { phoneHash } = await load();
    expect(phoneHash("+15551234567")).toBe(phoneHash("+15551234567"));
    expect(phoneHash("+15551234567")).not.toContain("5551234567");
    expect(phoneHash("+15551234567")).not.toBe(phoneHash("+15551234568"));
  });

  it("produces an encrypted, recoverable-shaped stored identity", async () => {
    const { toStoredPhone, normalizePhone } = await load();
    const stored = toStoredPhone(normalizePhone("+15551234567"));
    expect(stored.phoneHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.phoneEncrypted).toMatch(/^v1:/);
    expect(stored.phoneEncrypted).not.toContain("5551234567");
    expect(stored.lastFour).toBe("4567");
    expect(stored.phoneKeyVersion).toBe(1);
  });

  it("round-trips through the shared decrypt", async () => {
    const { toStoredPhone, normalizePhone } = await load();
    const { decrypt } = await import("@/lib/server/crypto");
    const stored = toStoredPhone(normalizePhone("+15551234567"));
    expect(decrypt(stored.phoneEncrypted)).toBe("+15551234567");
  });
});
