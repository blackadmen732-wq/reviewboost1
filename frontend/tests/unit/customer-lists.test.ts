import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { columnLabels, extractRows, guessColumns, type Cell } from "@/features/connections/sheet-columns";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();
vi.mock("@/lib/server/supabase", () => ({
  serviceRoleClient: () => ({ rpc }),
}));

const OLD_ENV = { ...process.env };
const ORG = "7c000000-0000-4000-8000-00000000000a";
const USER = "7a000000-0000-4000-8000-00000000000a";

beforeAll(() => {
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.SMS_DEFAULT_COUNTRY_CALLING_CODE = "1";
});

afterAll(() => {
  process.env = { ...OLD_ENV };
});

beforeEach(() => {
  rpc.mockReset();
  process.env.SMS_DEFAULT_COUNTRY_CALLING_CODE = "1";
});

describe("finding the name and phone columns in a sheet", () => {
  it("finds a plain header row", () => {
    const cells: Cell[][] = [
      ["Name", "Email", "Phone"],
      ["Ana Ruiz", "ana@example.com", "(305) 555-0101"],
    ];
    expect(guessColumns(cells)).toEqual({ headerRow: 0, name: 0, lastName: null, phone: 2 });
  });

  it("uses first and last name columns when the sheet splits them", () => {
    const cells: Cell[][] = [
      ["First Name", "Last Name", "Last visit", "Cell #"],
      ["Ana", "Ruiz", "2026-10-01", 3055550101],
    ];
    const choice = guessColumns(cells);
    expect(choice).toEqual({ headerRow: 0, name: 0, lastName: 1, phone: 3 });
    expect(extractRows(cells, choice)).toEqual([{ row: 2, name: "Ana Ruiz", phone: "3055550101" }]);
  });

  it("skips a title line above the header", () => {
    const cells: Cell[][] = [["Customers 2026"], [], ["Client", "Mobile"], ["Ben Cole", "+1 305 555 0102"]];
    const choice = guessColumns(cells);
    expect(choice.headerRow).toBe(2);
    expect(extractRows(cells, choice)).toEqual([{ row: 4, name: "Ben Cole", phone: "+1 305 555 0102" }]);
  });

  it("does not mistake an email or business column for a name or phone", () => {
    const cells: Cell[][] = [["Business name", "Email", "Customer", "Phone number"]];
    expect(guessColumns(cells)).toEqual({ headerRow: 0, name: 2, lastName: null, phone: 3 });
  });

  it("drops blank rows but keeps a person with no phone, so the owner hears about them", () => {
    const cells: Cell[][] = [["Name", "Phone"], ["Ana", "3055550101"], [], ["", ""], ["Cara", ""]];
    expect(extractRows(cells, guessColumns(cells))).toEqual([
      { row: 2, name: "Ana", phone: "3055550101" },
      { row: 5, name: "Cara", phone: null },
    ]);
  });

  it("labels columns with their header and letter", () => {
    expect(columnLabels([["Name", "", "Phone"]], 0)).toEqual(["Name (A)", "Column B", "Phone (C)"]);
  });
});

describe("phone numbers typed into a sheet", () => {
  const load = () => import("@/lib/server/integrations/normalize");

  it.each([
    ["(305) 555-0101", "0101"],
    ["305.555.0101", "0101"],
    ["1-305-555-0101", "0101"],
    ["13055550101", "0101"],
    ["+1 305 555 0101", "0101"],
  ])("accepts %s", async (raw, lastFour) => {
    const { normalizeListPhone } = await load();
    const result = normalizeListPhone(raw);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.stored.lastFour).toBe(lastFour);
  });

  it("gives the same contact for every way of writing one number", async () => {
    const { normalizeListPhone } = await load();
    const hashes = ["(305) 555-0101", "1 305 555 0101", "+13055550101"].map((raw) => {
      const result = normalizeListPhone(raw);
      return result.kind === "ok" ? result.stored.phoneHash : null;
    });
    expect(new Set(hashes).size).toBe(1);
  });

  it.each([
    ["555-0101", "too short"],
    ["1 1305 555 0101", "a 1 in front of an 11-digit number"],
    ["305 555 01011", "eleven digits not starting with 1"],
    ["(105) 555-0101", "an area code starting with 1"],
    ["305-155-0101", "an exchange starting with 1"],
    ["call me", "words"],
    ["+1 305 555 010", "a short +1 number"],
  ])("refuses %s (%s) instead of guessing", async (raw) => {
    const { normalizeListPhone } = await load();
    expect(normalizeListPhone(raw).kind).toBe("invalid");
  });

  it("treats an empty cell as missing, not invalid", async () => {
    const { normalizeListPhone } = await load();
    expect(normalizeListPhone("  ").kind).toBe("missing");
    expect(normalizeListPhone(null).kind).toBe("missing");
  });

  it("still accepts other countries written in international form", async () => {
    const { normalizeListPhone } = await load();
    expect(normalizeListPhone("+44 20 7946 0958").kind).toBe("ok");
  });
});

describe("bringing in a list", () => {
  const load = () => import("@/lib/server/customers/list-import");

  it("sends only stored forms of a person to the database, never the raw number or name", async () => {
    const { importCustomerList } = await load();
    rpc.mockResolvedValue({ data: [{ import_id: "i1", created_count: 1, updated_count: 0, unchanged_count: 0 }], error: null });

    const result = await importCustomerList(
      ORG,
      USER,
      {
        source: "google_sheets",
        label: "Customers",
        sourceRef: "1AbCdEfGhIjKlMnOp",
        rows: [
          { row: 2, name: "Ana Ruiz", phone: "(305) 555-0101" },
          { row: 3, name: "No Phone", phone: null },
          { row: 4, name: "Bad", phone: "12" },
        ],
      },
      "req",
    );

    expect(result).toMatchObject({
      created: 1,
      unusableCount: 2,
      unusable: [
        { row: 3, reason: "no_phone" },
        { row: 4, reason: "invalid_phone" },
      ],
    });
    const [fn, args] = rpc.mock.calls[0]!;
    expect(fn).toBe("rpc_customer_list_import");
    expect(args).toMatchObject({ p_org_id: ORG, p_actor: USER, p_rows_received: 3, p_rows_unusable: 2 });
    const sent = JSON.stringify(args);
    expect(sent).not.toContain("3055550101");
    expect(sent).not.toContain("555-0101");
    expect(sent).not.toContain("Ana Ruiz");
    expect(sent).not.toContain("1AbCdEfGhIjKlMnOp");
    expect(args.p_rows).toHaveLength(1);
    expect(args.p_rows[0].phone_last_four).toBe("0101");
  });

  it("refuses an empty sheet without touching the database", async () => {
    const { importCustomerList } = await load();
    await expect(
      importCustomerList(ORG, USER, { source: "google_sheets", label: "Empty", sourceRef: "1AbCdEfGhIjKlMnOp", rows: [] }, "req"),
    ).rejects.toThrow("no rows");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects extra fields and more than 2,000 rows", async () => {
    const { listImportSchema } = await load();
    const base = { source: "google_sheets", label: "L", sourceRef: "1AbCdEfGhIjKlMnOp" };
    expect(listImportSchema.safeParse({ ...base, rows: [], consent: true }).success).toBe(false);
    expect(
      listImportSchema.safeParse({ ...base, rows: Array.from({ length: 2001 }, (_, i) => ({ row: i + 2, name: null, phone: "3055550101" })) })
        .success,
    ).toBe(false);
    expect(listImportSchema.safeParse({ ...base, rows: [{ row: 2, name: "A", phone: "1", email: "x" }] }).success).toBe(false);
  });

  it("accepts a CSV list with no file id and keeps no digest for it", async () => {
    const { importCustomerList, listImportSchema } = await load();
    expect(listImportSchema.safeParse({ source: "csv", label: "Clients", rows: [] }).success).toBe(true);
    expect(listImportSchema.safeParse({ source: "csv", label: "Clients", sourceRef: "1AbCdEfGhIjKlMnOp", rows: [] }).success).toBe(false);
    expect(listImportSchema.safeParse({ source: "google_sheets", label: "Clients", rows: [] }).success).toBe(false);
    rpc.mockResolvedValue({ data: [{ import_id: "i2", created_count: 1, updated_count: 0, unchanged_count: 0 }], error: null });
    await importCustomerList(ORG, USER, { source: "csv", label: "Clients", rows: [{ row: 2, name: "Ana", phone: "3055550101" }] }, "req");
    const [, args] = rpc.mock.calls[0]!;
    expect(args).toMatchObject({ p_source: "csv", p_ref_digest: null });
  });

  it("says a business it can't find is not found", async () => {
    const { importCustomerList } = await load();
    rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "not_found_or_forbidden" } });
    await expect(
      importCustomerList(ORG, USER, { source: "google_sheets", label: "L", sourceRef: "1AbCdEfGhIjKlMnOp", rows: [{ row: 2, name: null, phone: "3055550101" }] }, "req"),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("Google Sheets in the directory", () => {
  const load = () => import("@/lib/server/integrations/registry");

  it("is coming soon until its keys and a default country are set", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "");
    const { getProvider } = await load();
    expect(getProvider("google_sheets")?.availability).toBe("in_setup");
    vi.unstubAllEnvs();
  });

  it("is available once configured, but never through the sign-in-and-sync routes", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "id.apps.googleusercontent.com");
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_API_KEY", "key");
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER", "123456789012");
    const { getConnectableProvider, getProvider } = await load();
    expect(getProvider("google_sheets")?.availability).toBe("available");
    expect(getProvider("google_sheets")?.connectKind).toBe("list");
    expect(getConnectableProvider("google_sheets")).toBeNull();
    vi.stubEnv("SMS_DEFAULT_COUNTRY_CALLING_CODE", "");
    expect(getProvider("google_sheets")?.availability).toBe("in_setup");
    vi.unstubAllEnvs();
  });
});
