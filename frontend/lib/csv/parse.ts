import type { Cell } from "@/features/connections/sheet-columns";

/**
 * A small, strict CSV reader for customer lists saved from Excel, Numbers or
 * Google Sheets. Handles quoted fields, doubled quotes, newlines inside quotes,
 * a byte-order mark, and the three separators those apps write (comma,
 * semicolon in many European locales, tab). Nothing is evaluated: a cell that
 * starts with "=" stays text.
 */

export const MAX_CSV_ROWS = 2010;
export const MAX_CSV_COLUMNS = 26;
export const MAX_CSV_BYTES = 2 * 1024 * 1024;

export function detectDelimiter(text: string): "," | ";" | "\t" {
  // Look past a title line ("Client list 2026") or a blank row: the header is
  // often a few lines down. The separator that splits some early line into the
  // most fields wins.
  const lines = text.split(/\r?\n/, 10);
  const best = { ",": 0, ";": 0, "\t": 0 } as Record<"," | ";" | "\t", number>;
  for (const line of lines) {
    const counts = { ",": 0, ";": 0, "\t": 0 } as Record<"," | ";" | "\t", number>;
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch in counts) counts[ch as "," | ";" | "\t"] += 1;
    }
    for (const key of [",", ";", "\t"] as const) best[key] = Math.max(best[key], counts[key]);
  }
  if (best["\t"] > best[","] && best["\t"] >= best[";"]) return "\t";
  if (best[";"] > best[","]) return ";";
  return ",";
}

export function parseCsv(input: string): Cell[][] {
  const text = input.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const rows: Cell[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const endField = () => {
    if (row.length < MAX_CSV_COLUMNS) row.push(field.trim());
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.trim() === "") {
      field = "";
      quoted = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      endRow();
      if (rows.length >= MAX_CSV_ROWS) return rows;
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}
