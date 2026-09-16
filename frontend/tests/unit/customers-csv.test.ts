import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const load = () => import("@/lib/server/customers/csv");

describe("CSV parser + adapter", () => {
  it("parses a normal CSV, trims values, and numbers data rows from 2", async () => {
    const { parseCsv } = await load();
    const { header, rows } = parseCsv("name,phone\nAlice, +15551230001 \nBob,+15551230002\n");
    expect(header).toEqual(["name", "phone"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.rowNumber).toBe(2);
    expect(rows[0]!.values).toEqual({ name: "Alice", phone: "+15551230001" });
    expect(rows[1]!.rowNumber).toBe(3);
  });

  it("handles quoted cells, embedded commas, escaped quotes, and CRLF line endings", async () => {
    const { parseCsv } = await load();
    const csv = 'name,note\r\n"Doe, Jane","She said ""hi"""\r\n';
    const { rows } = parseCsv(csv);
    expect(rows[0]!.values).toEqual({ name: "Doe, Jane", note: 'She said "hi"' });
  });

  it("strips a UTF-8 BOM without producing a mangled first column name", async () => {
    const { parseCsv } = await load();
    const csv = "﻿name,phone\nAlice,+15551230001\n";
    const { header } = parseCsv(csv);
    expect(header[0]).toBe("name");
  });

  it("rejects an oversized file (rows > max)", async () => {
    const { parseCsv, CsvParseError } = await load();
    const body = "name\n" + "x\n".repeat(11);
    expect(() => parseCsv(body, { maxRows: 10 })).toThrow(CsvParseError);
  });

  it("rejects a file with no header row", async () => {
    const { parseCsv } = await load();
    expect(() => parseCsv("")).toThrow();
  });

  it("rejects an unterminated quoted cell rather than silently swallowing input", async () => {
    const { parseCsv } = await load();
    expect(() => parseCsv('name\n"unterminated')).toThrow();
  });

  it("sanitizes formula-injection sigils for values that could round-trip through an export", async () => {
    const { sanitizeForExport } = await load();
    expect(sanitizeForExport("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(sanitizeForExport("+1 5551230001")).toBe("'+1 5551230001");
    expect(sanitizeForExport("-1")).toBe("'-1");
    expect(sanitizeForExport("@who")).toBe("'@who");
    expect(sanitizeForExport("Alice")).toBe("Alice");
    expect(sanitizeForExport("")).toBe("");
  });

  it("CsvCustomerSourceAdapter projects columns via the caller's mapping (never guesses)", async () => {
    const { CsvCustomerSourceAdapter } = await load();
    const body = "First Name,Cell,Email,POS ID\nAlice,+15551230001,alice@example.com,pos-1\n";
    const adapter = new CsvCustomerSourceAdapter(body, {
      displayName: "First Name",
      phone: "Cell",
      email: "Email",
      externalId: "POS ID",
    });
    const rows = await adapter.fetch();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      externalId: "pos-1",
      displayName: "Alice",
      rawPhone: "+15551230001",
      rawEmail: "alice@example.com",
      observedAt: null,
      meta: null,
    });
  });

  it("adapter throws when a mapped column does not exist in the header", async () => {
    const { CsvCustomerSourceAdapter, CsvParseError } = await load();
    const adapter = new CsvCustomerSourceAdapter("name\nAlice\n", { phone: "Cell" });
    await expect(adapter.fetch()).rejects.toBeInstanceOf(CsvParseError);
  });
});
