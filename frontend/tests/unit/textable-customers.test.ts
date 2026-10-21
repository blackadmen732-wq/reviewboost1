import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { customerLabel, filterCustomers, type PickerCustomer } from "@/features/dashboard/customer-picker";

vi.mock("server-only", () => ({}));

/**
 * Connections → Text Requests: picking an imported customer.
 *
 * The properties: the status comes from the same gate the send path uses and
 * fails closed; a customer of another business is not found; a picked
 * customer's number is looked up on the server; and a request names exactly
 * one recipient.
 */

const rpc = vi.fn();
vi.mock("@/lib/server/supabase", () => ({
  serviceRoleClient: () => ({ rpc }),
}));

const OLD_ENV = { ...process.env };
const ORG = "7c000000-0000-4000-8000-00000000000a";
const CUSTOMER = "7d000000-0000-4000-8000-00000000000a";
const STAND = "7e000000-0000-4000-8000-00000000000a";

beforeAll(() => {
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.PUBLIC_FRONTEND_URL = "https://app.example.com";
});
afterAll(() => {
  process.env = { ...OLD_ENV };
});
beforeEach(() => rpc.mockReset());

/**
 * A chainable stand-in for the caller's RLS-scoped client. Like the real Data
 * API it returns at most 1,000 rows per read, and it records each read's
 * range and id-list size.
 */
function fakeDb(tables: Record<string, { data: unknown; error: unknown }>) {
  const reads: Array<{ table: string; range: [number, number] | null; ids: number }> = [];
  return {
    reads,
    from(table: string) {
      const result = tables[table] ?? { data: [], error: null };
      const read = { table, range: null as [number, number] | null, ids: 0 };
      reads.push(read);
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "limit"]) builder[method] = () => builder;
      builder["in"] = (_column: string, values: unknown[]) => {
        read.ids = values.length;
        return builder;
      };
      builder["range"] = (from: number, to: number) => {
        read.range = [from, to];
        return builder;
      };
      const rows = () => {
        if (!Array.isArray(result.data)) return result.data;
        const sliced = read.range ? result.data.slice(read.range[0], read.range[1] + 1) : result.data;
        return sliced.slice(0, 1000);
      };
      builder["maybeSingle"] = () =>
        Promise.resolve({ data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data, error: result.error });
      builder["then"] = (resolve: (value: unknown) => unknown) => resolve({ data: rows(), error: result.error });
      return builder;
    },
  };
}

describe("the texting status in the picker", () => {
  it("maps the gate's answer to four plain states", async () => {
    const { statusFromGate } = await import("@/lib/server/customers/textable");
    expect(statusFromGate(true, null)).toBe("can_text");
    expect(statusFromGate(false, "no_consent")).toBe("no_consent");
    expect(statusFromGate(false, "opt_out")).toBe("opted_out");
    expect(statusFromGate(false, "stop_keyword")).toBe("opted_out");
    expect(statusFromGate(false, "recent_send")).toBe("on_hold");
    expect(statusFromGate(false, "something_new")).toBe("on_hold");
  });

  it("lists customers with names, sources and the gate's status, asking the gate once", async () => {
    const { encrypt } = await import("@/lib/server/crypto");
    const { listTextableCustomers } = await import("@/lib/server/customers/textable");
    const db = fakeDb({
      customers: {
        data: [
          { id: "c1", phone_hash: "h".repeat(32), phone_last_four: "0101", display_name_encrypted: encrypt("Ana Ruiz") },
          { id: "c2", phone_hash: "g".repeat(32), phone_last_four: "0102", display_name_encrypted: null },
        ],
        error: null,
      },
      customer_source_profiles: {
        data: [
          { customer_id: "c1", source_kind: "google_sheets" },
          { customer_id: "c1", source_kind: "csv" },
        ],
        error: null,
      },
    });
    rpc.mockResolvedValue({
      data: [
        { phone_hash: "h".repeat(32), allowed: true, reason: null },
        { phone_hash: "g".repeat(32), allowed: false, reason: "no_consent" },
      ],
      error: null,
    });

    const list = await listTextableCustomers(db as never, ORG, "req");

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]![0]).toBe("rpc_sms_can_send_many");
    expect(list).toEqual([
      {
        customerId: "c1",
        name: "Ana Ruiz",
        lastFour: "0101",
        sources: ["Google Sheets", "Spreadsheet"],
        status: "can_text",
        statusText: "Can text",
      },
      {
        customerId: "c2",
        name: null,
        lastFour: "0102",
        sources: [],
        status: "no_consent",
        statusText: "Hasn't agreed to texts yet",
      },
    ]);
  });

  it("reads past the Data API's 1,000-row cap in pages, and asks the gate in pages", async () => {
    const { listTextableCustomers } = await import("@/lib/server/customers/textable");
    const many = Array.from({ length: 1200 }, (_, i) => ({
      id: `c${i}`,
      phone_hash: `hash${String(i).padStart(28, "0")}`,
      phone_last_four: "0101",
      display_name_encrypted: null,
    }));
    const db = fakeDb({ customers: { data: many, error: null } });
    const gateCalls: string[][] = [];
    rpc.mockImplementation((...call: unknown[]) => {
      const hashes = ((call[1] ?? {}) as { p_phone_hashes?: string[] }).p_phone_hashes ?? [];
      gateCalls.push(hashes);
      return Promise.resolve({
        data: hashes.map((hash) => ({ phone_hash: hash, allowed: true, reason: null })),
        error: null,
      });
    });

    const list = await listTextableCustomers(db as never, ORG, "req");

    expect(list).toHaveLength(1200);
    expect(list.every((customer) => customer.status === "can_text")).toBe(true);
    const customerReads = db.reads.filter((read) => read.table === "customers");
    expect(customerReads.every((read) => read.range && read.range[1] - read.range[0] + 1 <= 500)).toBe(true);
    const sourceReads = db.reads.filter((read) => read.table === "customer_source_profiles");
    expect(sourceReads.every((read) => read.ids <= 150)).toBe(true);
    expect(gateCalls.length).toBe(3);
    expect(gateCalls.every((hashes) => hashes.length > 0 && hashes.length <= 500)).toBe(true);
  });

  it("fails closed: no gate answer means an error, never 'Can text'", async () => {
    const { listTextableCustomers } = await import("@/lib/server/customers/textable");
    const db = fakeDb({
      customers: { data: [{ id: "c1", phone_hash: "h".repeat(32), phone_last_four: "0101", display_name_encrypted: null }], error: null },
    });
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "down" } });
    await expect(listTextableCustomers(db as never, ORG, "req")).rejects.toMatchObject({ status: 503 });
  });

  it("does not ask the gate when there are no customers", async () => {
    const { listTextableCustomers } = await import("@/lib/server/customers/textable");
    const list = await listTextableCustomers(fakeDb({ customers: { data: [], error: null } }) as never, ORG, "req");
    expect(list).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("turning a picked customer into a number", () => {
  it("decrypts the stored number on the server", async () => {
    const { encrypt } = await import("@/lib/server/crypto");
    const { resolveCustomerPhone } = await import("@/lib/server/customers/textable");
    const db = fakeDb({ customers: { data: [{ phone_encrypted: encrypt("+13055550101") }], error: null } });
    await expect(resolveCustomerPhone(db as never, ORG, CUSTOMER, "req")).resolves.toBe("+13055550101");
  });

  it("says not found for a customer it cannot see (another business)", async () => {
    const { resolveCustomerPhone } = await import("@/lib/server/customers/textable");
    const db = fakeDb({ customers: { data: [], error: null } });
    await expect(resolveCustomerPhone(db as never, ORG, CUSTOMER, "req")).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a customer with no saved number", async () => {
    const { resolveCustomerPhone } = await import("@/lib/server/customers/textable");
    const db = fakeDb({ customers: { data: [{ phone_encrypted: null }], error: null } });
    await expect(resolveCustomerPhone(db as never, ORG, CUSTOMER, "req")).rejects.toMatchObject({ status: 409 });
  });
});

describe("a Text Request names exactly one recipient", () => {
  const load = () => import("@/lib/server/sms/text-request-service");

  it("accepts a customer instead of a number", async () => {
    const { previewSchema, scheduleSchema } = await load();
    expect(previewSchema.safeParse({ customerId: CUSTOMER, standId: STAND }).success).toBe(true);
    expect(scheduleSchema.safeParse({ customerId: CUSTOMER, standId: STAND }).success).toBe(true);
  });

  it("refuses both, and refuses neither", async () => {
    const { previewSchema, scheduleSchema, consentAttestationSchema } = await load();
    expect(previewSchema.safeParse({ customerId: CUSTOMER, phone: "+13055550101", standId: STAND }).success).toBe(false);
    expect(scheduleSchema.safeParse({ standId: STAND }).success).toBe(false);
    expect(
      consentAttestationSchema.safeParse({
        standId: STAND,
        method: "in_person",
        wordingVersion: "owner-attestation-v1",
        confirmed: true,
      }).success,
    ).toBe(false);
  });

  it("refuses a customer id that is not an id", async () => {
    const { scheduleSchema } = await load();
    expect(scheduleSchema.safeParse({ customerId: "../../etc", standId: STAND }).success).toBe(false);
  });
});

describe("finding a customer in the picker", () => {
  const people: PickerCustomer[] = [
    { customerId: "1", name: "Ana Ruiz", lastFour: "0101", sources: [], status: "can_text", statusText: "Can text" },
    { customerId: "2", name: "Ben Cole", lastFour: "0202", sources: [], status: "no_consent", statusText: "x" },
    { customerId: "3", name: null, lastFour: "0303", sources: [], status: "opted_out", statusText: "x" },
  ];

  it("matches names regardless of case, and the last four digits", () => {
    expect(filterCustomers(people, "ana").map((p) => p.customerId)).toEqual(["1"]);
    expect(filterCustomers(people, "0303").map((p) => p.customerId)).toEqual(["3"]);
    expect(filterCustomers(people, "(305) 555-0202").map((p) => p.customerId)).toEqual(["2"]);
    expect(filterCustomers(people, "zed")).toEqual([]);
  });

  it("labels a nameless customer by their last four", () => {
    expect(customerLabel({ name: null, lastFour: "0303" })).toBe("••• 0303");
    expect(customerLabel({ name: "Ana Ruiz", lastFour: "0101" })).toBe("Ana Ruiz · ••• 0101");
  });
});
