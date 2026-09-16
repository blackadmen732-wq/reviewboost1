import "server-only";

import type { CsvHeaderMapping, CustomerSourceAdapter, NormalizedCustomerRow } from "@/lib/server/customers/types";

/**
 * CSV source adapter — the first real customer source.
 *
 * A CSV import is bounded: the caller provides the raw file contents (a
 * String, not a stream, so this adapter is uniform between the API upload path
 * and the tests), the caller also provides a header-to-field mapping so the
 * adapter never *guesses* which column is "phone" (guessing is how a "Notes"
 * column becomes phone-hashed customer identity), and the adapter enforces a
 * row cap so an oversized upload is rejected before it can flood the pipeline.
 *
 * NO CSV INJECTION SLIP-THROUGH: any cell that starts with `=`, `+`, `-`, or
 * `@` is prefixed with a single quote before being surfaced back to the caller
 * (in error diagnostics or a preview). That is the standard mitigation for
 * spreadsheet formula injection when the same values might round-trip through
 * an exported CSV later. The stored data never carries the prefix — this
 * matters only when we hand a value back to a UI/export.
 */

const DEFAULT_MAX_ROWS = 10_000;
const MAX_CELL_LENGTH = 500;

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvParseError";
  }
}

export interface CsvParsedRow {
  rowNumber: number;
  values: Record<string, string>;
}

/**
 * RFC-4180-ish parser: comma-separated, `\n` or `\r\n` line breaks, double
 * quotes for cells that contain commas or newlines, `""` for a literal quote
 * inside a quoted cell. Small, dependency-free, deterministic.
 */
export function parseCsv(text: string, options?: { maxRows?: number }): { header: string[]; rows: CsvParsedRow[] } {
  const maxRows = options?.maxRows ?? DEFAULT_MAX_ROWS;
  if (typeof text !== "string") throw new CsvParseError("CSV body must be a string.");
  if (text.length === 0) throw new CsvParseError("CSV is empty.");
  // Strip a UTF-8 BOM if present (some spreadsheet exports emit one).
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        if (field.length !== 0) throw new CsvParseError("Unexpected quote inside a cell.");
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (ch === "\r") {
        // \r\n handled by consuming \n on the next iteration; a bare \r is treated as a line end.
        if (text[i + 1] === "\n") continue;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += ch;
      }
    }
    if (field.length > MAX_CELL_LENGTH) {
      throw new CsvParseError(`A cell exceeds the ${MAX_CELL_LENGTH}-character limit.`);
    }
  }
  if (inQuotes) throw new CsvParseError("CSV ended inside a quoted cell.");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) throw new CsvParseError("CSV has no header row.");
  const header = rows[0]!.map((h) => h.trim());
  const data = rows.slice(1).filter((r) => !(r.length === 1 && r[0]!.trim() === ""));

  if (data.length > maxRows) {
    throw new CsvParseError(`CSV has ${data.length} rows; the limit is ${maxRows}.`);
  }

  const parsed: CsvParsedRow[] = [];
  for (let idx = 0; idx < data.length; idx++) {
    const values: Record<string, string> = {};
    const r = data[idx]!;
    for (let c = 0; c < header.length; c++) values[header[c]!] = (r[c] ?? "").trim();
    parsed.push({ rowNumber: idx + 2, values }); // +2: header is row 1, data starts at 2.
  }
  return { header, rows: parsed };
}

/** Neutralise a formula-injection sigil for values that may be re-exported. */
export function sanitizeForExport(value: string): string {
  if (value.length === 0) return value;
  const first = value.charCodeAt(0);
  // = 61, + 43, - 45, @ 64, TAB 9, CR 13
  if (first === 61 || first === 43 || first === 45 || first === 64 || first === 9 || first === 13) {
    return "'" + value;
  }
  return value;
}

/**
 * A CSV adapter for a given file body and header mapping.
 *
 * It is deliberately dumb: it parses, projects columns into the normalized
 * customer row shape, and hands them back. All validation, dedupe, PII
 * hashing, and matching live in the import service — the adapter's job is only
 * to speak "CSV".
 */
export class CsvCustomerSourceAdapter implements CustomerSourceAdapter {
  readonly kind = "csv" as const;
  private readonly body: string;
  private readonly mapping: CsvHeaderMapping;
  private readonly maxRows: number;

  constructor(body: string, mapping: CsvHeaderMapping, options?: { maxRows?: number }) {
    this.body = body;
    this.mapping = mapping;
    this.maxRows = options?.maxRows ?? DEFAULT_MAX_ROWS;
  }

  async discover(): Promise<{ fields: string[] }> {
    const { header } = parseCsv(this.body, { maxRows: this.maxRows });
    return { fields: header };
  }

  async fetch(): Promise<NormalizedCustomerRow[]> {
    const { header, rows } = parseCsv(this.body, { maxRows: this.maxRows });
    const need = ["phone"] as const;
    for (const k of need) {
      const src = this.mapping[k];
      if (src && !header.includes(src)) {
        throw new CsvParseError(`Column mapping references "${src}" which is not in the CSV header.`);
      }
    }
    return rows.map((r) => {
      const get = (k: keyof CsvHeaderMapping): string | null => {
        const col = this.mapping[k];
        if (!col) return null;
        const raw = r.values[col];
        if (raw === undefined || raw === "") return null;
        return raw;
      };
      const observedAtRaw = get("observedAt");
      const observedAt = observedAtRaw ? parseDate(observedAtRaw) : null;
      return {
        externalId: get("externalId"),
        displayName: get("displayName"),
        rawPhone: get("phone"),
        rawEmail: get("email"),
        observedAt,
        meta: null,
      };
    });
  }
}

function parseDate(raw: string): Date | null {
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t) : null;
}
