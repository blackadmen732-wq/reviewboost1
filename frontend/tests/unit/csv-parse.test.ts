import { describe, expect, it } from "vitest";

import { extractRows, guessColumns } from "@/features/connections/sheet-columns";
import { detectDelimiter, MAX_CSV_ROWS, parseCsv } from "@/lib/csv/parse";

describe("reading a customer CSV", () => {
  it("reads a plain Excel export, with a byte-order mark and Windows line endings", () => {
    const cells = parseCsv("﻿Name,Phone\r\nAna Ruiz,(305) 555-0101\r\nBen Cole,305.555.0102\r\n");
    expect(cells).toEqual([
      ["Name", "Phone"],
      ["Ana Ruiz", "(305) 555-0101"],
      ["Ben Cole", "305.555.0102"],
    ]);
  });

  it("keeps commas, quotes and line breaks inside quoted fields", () => {
    const cells = parseCsv('Name,Phone,Note\n"Ruiz, Ana","3055550101","said ""hi""\nthen left"\n');
    expect(cells[1]).toEqual(["Ruiz, Ana", "3055550101", 'said "hi"\nthen left']);
  });

  it("reads semicolon and tab files from other spreadsheet apps", () => {
    expect(detectDelimiter("Name;Phone;Email")).toBe(";");
    expect(detectDelimiter("Name\tPhone")).toBe("\t");
    expect(parseCsv("Name;Phone\nAna;3055550101")[1]).toEqual(["Ana", "3055550101"]);
  });

  it("does not let a comma inside quotes decide the separator", () => {
    expect(detectDelimiter('"Last, First";Phone;Email')).toBe(";");
  });

  it("finds the separator below a title line and a blank row", () => {
    const cells = parseCsv("Client list 2026\n\nFirst Name;Cell\nAna;3055550101\n");
    expect(cells[2]).toEqual(["First Name", "Cell"]);
    expect(extractRows(cells, guessColumns(cells))).toEqual([{ row: 4, name: "Ana", phone: "3055550101" }]);
  });

  it("leaves formulas as text", () => {
    expect(parseCsv("Name,Phone\n=HYPERLINK(1),3055550101")[1]![0]).toBe("=HYPERLINK(1)");
  });

  it("stops at the row limit instead of reading a huge file", () => {
    const big = "Name,Phone\n" + "A,3055550101\n".repeat(MAX_CSV_ROWS + 50);
    expect(parseCsv(big)).toHaveLength(MAX_CSV_ROWS);
  });

  it("goes through the same column check as a Google Sheet", () => {
    const cells = parseCsv("First Name,Last Name,Mobile\nAna,Ruiz,3055550101\n,,\nCara,Diaz,\n");
    expect(extractRows(cells, guessColumns(cells))).toEqual([
      { row: 2, name: "Ana Ruiz", phone: "3055550101" },
      { row: 4, name: "Cara Diaz", phone: null },
    ]);
  });
});
