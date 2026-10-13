import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const serviceRpc = vi.fn();
vi.mock("@/lib/server/supabase", () => ({
  serviceRoleClient: () => ({ rpc: serviceRpc }),
}));

/**
 * Customers service: what is encrypted, what crosses to the browser, how a
 * mistake reads, and that a saved customer can be texted without the browser
 * ever holding their number.
 */

const OLD_ENV = { ...process.env };

beforeAll(() => {
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.PUBLIC_FRONTEND_URL = "https://app.example.com";
});

afterAll(() => {
  process.env = { ...OLD_ENV };
});

beforeEach(() => {
  serviceRpc.mockReset();
});

const ORG = "7c000000-0000-0000-0000-00000000000a";
const CUSTOMER = "9a000000-0000-4000-8000-00000000000a";
const STAND = "7e000000-0000-4000-8000-00000000000a";

const load = () => import("@/lib/server/customers/customer-service");
const crypto = () => import("@/lib/server/crypto");

interface Result {
  data: unknown;
  error: unknown;
}

/** RLS-scoped client stand-in: rpc by name, and one row per table. */
function makeContext(rpcs: Record<string, Result>, rows: Record<string, Result> = {}) {
  const rpc = vi.fn(async (name: string) => rpcs[name] ?? { data: null, error: { message: `unexpected ${name}` } });
  const db = {
    rpc,
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => rows[table] ?? { data: null, error: null },
      };
      return builder;
    },
  };
  return { context: { orgId: ORG, userId: "u-1", role: "owner", db } as never, rpc };
}

describe("saving a customer", () => {
  it("encrypts the name and number, and sends only a digest and the last four in the clear", async () => {
    const { createCustomer } = await load();
    const { context, rpc } = makeContext({
      rpc_customer_manual_save: { data: [{ customer_id: CUSTOMER, outcome: "created" }], error: null },
    });

    await expect(
      createCustomer(context, { name: "  Ana   Lopez ", phone: "+1 (555) 201-0142" }, "req-1"),
    ).resolves.toEqual({ id: CUSTOMER, lastFour: "0142", linked: false });

    const [name, args] = rpc.mock.calls[0]! as unknown as [string, Record<string, unknown>];
    expect(name).toBe("rpc_customer_manual_save");
    expect(args.p_org_id).toBe(ORG);
    expect(args.p_customer_id).toBeNull();
    expect(String(args.p_name_digest)).toMatch(/^[A-Za-z0-9_-]{16,}/);
    expect(args.p_phone_last_four).toBe("0142");
    expect(String(args.p_phone_hash)).toMatch(/^[A-Za-z0-9_-]{16,}/);
    expect(JSON.stringify(args)).not.toContain("5552010142");
    expect(JSON.stringify(args)).not.toContain("Ana");

    const { decrypt } = await crypto();
    expect(decrypt(args.p_phone_encrypted as string)).toBe("+15552010142");
    expect(decrypt(args.p_name_encrypted as string)).toBe("Ana Lopez");
  });

  it("refuses a malformed number in words the owner can act on, not as a server error", async () => {
    const { createCustomer } = await load();
    const { context, rpc } = makeContext({});
    await expect(createCustomer(context, { phone: "call me" }, "req-2")).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/country code/),
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("says a duplicate number is already saved, rather than merging", async () => {
    const { createCustomer } = await load();
    const { context } = makeContext({
      rpc_customer_manual_save: { data: null, error: { message: "contact_exists" } },
    });
    await expect(createCustomer(context, { phone: "+15552010142" }, "req-3")).rejects.toMatchObject({
      status: 409,
      message: "That number is already saved.",
    });
  });

  it("sends no number when an edit leaves it alone, and refuses changing an app's number", async () => {
    const { updateCustomer } = await load();
    const { context, rpc } = makeContext({
      rpc_customer_manual_save: { data: [{ customer_id: CUSTOMER, outcome: "updated" }], error: null },
    });
    await updateCustomer(context, CUSTOMER, { name: "Ana" }, "req-4");
    const args = (rpc.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(args.p_customer_id).toBe(CUSTOMER);
    expect(args.p_phone_hash).toBeNull();
    expect(args.p_phone_encrypted).toBeNull();

    const refused = makeContext({
      rpc_customer_manual_save: { data: null, error: { message: "phone_from_source" } },
    });
    await expect(updateCustomer(refused.context, CUSTOMER, { phone: "+15559990000" }, "req-4b")).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/connected app/),
    });
  });

  it("links a number a connected app already knows instead of duplicating it", async () => {
    const { createCustomer } = await load();
    const { context } = makeContext({
      rpc_customer_manual_save: { data: [{ customer_id: CUSTOMER, outcome: "linked" }], error: null },
    });
    await expect(createCustomer(context, { phone: "+15552010142" }, "req-4c")).resolves.toMatchObject({ linked: true });
  });

  it("keeps a customer a connected app still knows when the owner removes theirs", async () => {
    const { deleteCustomer } = await load();
    const { context } = makeContext({ rpc_customer_manual_delete: { data: "kept_from_source", error: null } });
    await expect(deleteCustomer(context, CUSTOMER, "req-4d")).resolves.toEqual({ outcome: "kept_from_source" });
  });

  it("reports a removal that found nothing as not found", async () => {
    const { deleteCustomer } = await load();
    const { context } = makeContext({ rpc_customer_manual_delete: { data: "not_found", error: null } });
    await expect(deleteCustomer(context, CUSTOMER, "req-5")).rejects.toMatchObject({ status: 404 });
  });
});

describe("the list the browser receives", () => {
  it("carries a name and the last four, never the number, and reads consent from the ledger", async () => {
    const { listCustomers } = await load();
    const { encrypt } = await crypto();
    const { context } = makeContext({
      rpc_customers_list: {
        data: [
          {
            id: CUSTOMER,
            name_encrypted: encrypt("Ana"),
            names_differ: false,
            phone_encrypted: encrypt("+15552010142"),
            phone_last_four: "0142",
            has_manual: true,
            sources: ["manual", "square"],
            consent_status: "opted_in",
            last_visit_at: "2026-10-12T14:00:00Z",
            last_visit_kind: "payment",
            last_visit_location: null,
            last_request_status: "delivered",
            last_request_at: "2026-10-12T15:00:00Z",
            created_at: "2026-10-01T15:00:00Z",
          },
          {
            id: "9a000000-0000-4000-8000-00000000000b",
            name_encrypted: null,
            names_differ: false,
            phone_encrypted: encrypt("+15557781000"),
            phone_last_four: "1000",
            has_manual: false,
            sources: ["square"],
            consent_status: null,
            last_visit_at: null,
            last_visit_kind: null,
            last_visit_location: null,
            last_request_status: null,
            last_request_at: null,
            created_at: "2026-10-02T15:00:00Z",
          },
        ],
        error: null,
      },
    });

    const list = await listCustomers(context, "req-6");
    expect(list[0]).toMatchObject({
      name: "Ana",
      lastFour: "0142",
      consent: { kind: "agreed" },
      sources: ["manual", "square"],
      addedByHand: true,
      lastVisitKind: "payment",
    });
    expect(list[1]).toMatchObject({ name: null, consent: { kind: "no_record" }, addedByHand: false });
    expect(JSON.stringify(list)).not.toMatch(/5552010142|5557781000|v1:/);
  });

  it("fails the read rather than showing an empty list", async () => {
    const { listCustomers } = await load();
    const { context } = makeContext({ rpc_customers_list: { data: null, error: { message: "boom" } } });
    await expect(listCustomers(context, "req-7")).rejects.toMatchObject({ status: 503 });
  });
});

describe("export", () => {
  it("includes whole numbers, neutralises spreadsheet formulas, and records the export first", async () => {
    const { exportCustomers } = await load();
    const { encrypt } = await crypto();
    const { context, rpc } = makeContext({
      rpc_customers_list: {
        data: [
          {
            id: CUSTOMER,
            name_encrypted: encrypt('=HYPERLINK("http://x","y")'),
            names_differ: false,
            phone_encrypted: encrypt("+15552010142"),
            phone_last_four: "0142",
            has_manual: true,
            sources: ["manual"],
            consent_status: "opted_out",
            last_visit_at: null,
            last_visit_kind: null,
            last_visit_location: null,
            last_request_status: null,
            last_request_at: null,
            created_at: "2026-10-01T15:00:00Z",
          },
        ],
        error: null,
      },
      rpc_customers_record_export: { data: null, error: null },
    });

    const { csv, count } = await exportCustomers(context, "req-8");
    expect(count).toBe(1);
    expect(csv).toContain('"+15552010142"');
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csv).toContain('"Asked not to be texted"');
    expect(rpc).toHaveBeenCalledWith("rpc_customers_record_export", {
      p_org_id: ORG,
      p_count: 1,
      p_request_id: "req-8",
    });
  });

  it("returns no file when the export cannot be recorded", async () => {
    const { exportCustomers } = await load();
    const { context } = makeContext({
      rpc_customers_list: { data: [], error: null },
      rpc_customers_record_export: { data: null, error: { message: "down" } },
    });
    await expect(exportCustomers(context, "req-9")).rejects.toMatchObject({ status: 503 });
  });
});

describe("texting a saved customer", () => {
  it("accepts a customer id or a number, never both and never neither", async () => {
    const { previewSchema, scheduleSchema, consentAttestationSchema } = await import(
      "@/lib/server/sms/text-request-service"
    );
    expect(previewSchema.safeParse({ customerId: CUSTOMER, standId: STAND }).success).toBe(true);
    expect(scheduleSchema.safeParse({ customerId: CUSTOMER, standId: STAND }).success).toBe(true);
    expect(scheduleSchema.safeParse({ phone: "+15552010142", customerId: CUSTOMER, standId: STAND }).success).toBe(
      false,
    );
    expect(scheduleSchema.safeParse({ standId: STAND }).success).toBe(false);
    expect(
      consentAttestationSchema.safeParse({
        customerId: CUSTOMER,
        standId: STAND,
        method: "in_person",
        wordingVersion: "owner-attestation-v1",
        confirmed: true,
      }).success,
    ).toBe(true);
  });

  it("previews to the saved number, read and decrypted on the server", async () => {
    const { previewTextRequest } = await import("@/lib/server/sms/text-request-service");
    const { encrypt } = await crypto();
    const { phoneHash } = await import("@/lib/server/sms/phone");
    serviceRpc.mockResolvedValue({ data: [{ allowed: true, reason: null }], error: null });

    const { context } = makeContext(
      {},
      {
        customers: { data: { phone_encrypted: encrypt("+15552010142") }, error: null },
        review_stands: {
          data: { id: STAND, location_id: "10000000-0000-4000-8000-000000000001", public_token_encrypted: encrypt("tok_abcdefgh123") },
          error: null,
        },
        locations: { data: { timezone: "America/New_York" }, error: null },
        organizations: { data: { name: "Mario's Pizza" }, error: null },
      },
    );

    const preview = await previewTextRequest(context, { customerId: CUSTOMER, standId: STAND }, "req-10");
    expect(preview.recipientLastFour).toBe("0142");
    expect(preview.body).toMatch(/^Mario's Pizza: /);
    expect(serviceRpc).toHaveBeenCalledWith("rpc_sms_can_send", {
      p_org_id: ORG,
      p_phone_hash: phoneHash("+15552010142"),
      p_purpose: "review_request",
    });
  });

  it("does not text a customer the business does not have", async () => {
    const { previewTextRequest } = await import("@/lib/server/sms/text-request-service");
    const { context } = makeContext({}, { customers: { data: null, error: null } });
    await expect(
      previewTextRequest(context, { customerId: CUSTOMER, standId: STAND }, "req-11"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("turns a typo in a typed number into a 400 the composer can show", async () => {
    const { previewTextRequest } = await import("@/lib/server/sms/text-request-service");
    const { context } = makeContext({});
    await expect(previewTextRequest(context, { phone: "12", standId: STAND }, "req-12")).rejects.toMatchObject({
      status: 400,
    });
  });
});
