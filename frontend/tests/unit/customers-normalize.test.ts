import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

beforeAll(() => {
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

const load = () => import("@/lib/server/customers/normalize");

describe("customer phone/email normalization", () => {
  it("normalises E.164 and produces a phone hash consistent with Text Requests", async () => {
    const { toStoredCustomerPhone, customerPhoneHash } = await load();
    // Same input via the customer path and the direct phoneHash yields the same
    // digest, so a customer's identity IS the identity Text Requests already
    // gates consent by.
    const stored = toStoredCustomerPhone("+15551234567");
    expect(stored.phoneHash).toBe(customerPhoneHash("+15551234567"));
    expect(stored.phoneLastFour).toBe("4567");
    expect(stored.phoneEncrypted).not.toBeNull();
  });

  it("accepts a national number with a defaultCountryCallingCode", async () => {
    const { toStoredCustomerPhone } = await load();
    const stored = toStoredCustomerPhone("(555) 123-4567", "1");
    expect(stored.phoneLastFour).toBe("4567");
  });

  it("throws PhoneNormalizationError for unparseable input", async () => {
    const { toStoredCustomerPhone, PhoneNormalizationError } = await load();
    expect(() => toStoredCustomerPhone("not a phone")).toThrow(PhoneNormalizationError);
  });

  it("lowercases + validates email, and hashes it under a distinct domain from phone", async () => {
    const { toStoredCustomerEmail, customerEmailHash, customerPhoneHash } = await load();
    const e = toStoredCustomerEmail("Alice@Example.COM");
    expect(e.emailDomain).toBe("example.com");
    expect(e.emailHash).toBe(customerEmailHash("alice@example.com"));
    // Domain-separated: an email hash can never collide with a phone hash.
    expect(customerEmailHash("alice@example.com")).not.toBe(customerPhoneHash("alice@example.com"));
  });

  it("rejects a malformed email", async () => {
    const { toStoredCustomerEmail, EmailNormalizationError } = await import(
      "@/lib/server/customers/normalize"
    );
    expect(() => toStoredCustomerEmail("not-an-email")).toThrow(EmailNormalizationError);
    expect(() => toStoredCustomerEmail("no at sign here")).toThrow();
  });
});
