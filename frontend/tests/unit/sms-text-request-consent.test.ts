import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();
vi.mock("@/lib/server/supabase", () => ({
  serviceRoleClient: () => ({ rpc }),
}));

const OLD_ENV = { ...process.env };

beforeAll(() => {
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.PUBLIC_FRONTEND_URL = "https://app.example.com";
});

afterAll(() => {
  process.env = { ...OLD_ENV };
});

beforeEach(() => {
  rpc.mockReset();
});

const load = () => import("@/lib/server/sms/text-request-service");
const STAND = "7e000000-0000-4000-8000-00000000000a";
const ORG = "7c000000-0000-0000-0000-00000000000a";

describe("Text Request schemas — consent is never a side effect of sending", () => {
  it("rejects the old consent field on schedule", async () => {
    const { scheduleSchema } = await load();
    const result = scheduleSchema.safeParse({
      phone: "+15551234567",
      standId: STAND,
      consent: { source: "owner_import" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects free-text messages; only approved template ids are accepted", async () => {
    const { scheduleSchema, previewSchema } = await load();
    expect(
      scheduleSchema.safeParse({ phone: "+15551234567", standId: STAND, messageTemplate: "20% off for 5 stars {{link}}" })
        .success,
    ).toBe(false);
    expect(
      previewSchema.safeParse({ phone: "+15551234567", standId: STAND, templateId: "anything_goes" }).success,
    ).toBe(false);
    expect(
      scheduleSchema.safeParse({ phone: "+15551234567", standId: STAND, templateId: "thanks_v1" }).success,
    ).toBe(true);
  });

  it("an attestation needs a method, the current wording version, and confirmed: true", async () => {
    const { consentAttestationSchema } = await load();
    const valid = {
      phone: "+15551234567",
      standId: STAND,
      method: "in_person",
      wordingVersion: "owner-attestation-v1",
      confirmed: true,
    };
    expect(consentAttestationSchema.safeParse(valid).success).toBe(true);
    expect(consentAttestationSchema.safeParse({ ...valid, confirmed: false }).success).toBe(false);
    expect(consentAttestationSchema.safeParse({ ...valid, confirmed: "true" }).success).toBe(false);
    expect(consentAttestationSchema.safeParse({ ...valid, method: "assumed" }).success).toBe(false);
    expect(consentAttestationSchema.safeParse({ ...valid, wordingVersion: "old" }).success).toBe(false);
    // The acting user comes from the session, never the body.
    expect(consentAttestationSchema.safeParse({ ...valid, attestedBy: "someone" }).success).toBe(false);
  });
});

describe("checkEligibility — the same gate dispatch uses, failing closed", () => {
  it("allows when the gate allows", async () => {
    const { checkEligibility } = await load();
    rpc.mockResolvedValue({ data: [{ allowed: true, reason: null }], error: null });
    await expect(checkEligibility(ORG, "a".repeat(64), "req-1")).resolves.toEqual({
      allowed: true,
      reason: null,
      message: null,
    });
    expect(rpc).toHaveBeenCalledWith("rpc_sms_can_send", {
      p_org_id: ORG,
      p_phone_hash: "a".repeat(64),
      p_purpose: "review_request",
    });
  });

  it("explains a missing consent in owner words", async () => {
    const { checkEligibility } = await load();
    rpc.mockResolvedValue({ data: [{ allowed: false, reason: "no_consent" }], error: null });
    const result = await checkEligibility(ORG, "a".repeat(64), "req-1");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("no_consent");
    expect(result.message).toMatch(/haven't agreed/);
  });

  it("refuses with a 503 when the gate cannot answer", async () => {
    const { checkEligibility } = await load();
    rpc.mockResolvedValue({ data: null, error: { message: "connection reset" } });
    await expect(checkEligibility(ORG, "a".repeat(64), "req-1")).rejects.toMatchObject({ status: 503 });
  });

  it("treats an empty answer as a no", async () => {
    const { checkEligibility } = await load();
    rpc.mockResolvedValue({ data: [], error: null });
    const result = await checkEligibility(ORG, "a".repeat(64), "req-1");
    expect(result.allowed).toBe(false);
  });
});
