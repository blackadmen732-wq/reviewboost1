/**
 * Reading a customer list out of a sheet's cells. Pure, so it is tested
 * without Google.
 *
 * A sheet is whatever the owner made: a header row somewhere near the top,
 * a "Phone" or "Cell" or "Mobile #" column, a name in one column or split
 * into first and last. We guess the columns from the header words and let
 * the owner change the guess; we never guess a phone number itself.
 */

export type Cell = string | number | boolean | null | undefined;

export interface ColumnChoice {
  /** Index of the header row within the cells; data starts on the next row. */
  headerRow: number;
  name: number | null;
  lastName: number | null;
  phone: number | null;
}

export interface ListRow {
  /** Row number as the sheet shows it (1-based). */
  row: number;
  name: string | null;
  phone: string | null;
}

const PHONE_WORDS = /\b(phone|mobile|cell|tel|telephone|number|whatsapp|sms|text)\b|phone|móvil|movil|celular|teléfono|telefono/i;
const FIRST_WORDS = /\bfirst\b|given|nombre\b|^name\s*1$/i;
const LAST_WORDS = /\blast\b|surname|family|apellido/i;
const NAME_WORDS = /\bname\b|customer|client|guest|contact|nombre/i;
const NOT_NAME = /\b(business|company|file|user ?name|email|e-mail)\b/i;

export function cellText(cell: Cell): string {
  if (cell === null || cell === undefined || typeof cell === "boolean") return "";
  if (typeof cell === "number") return Number.isFinite(cell) ? String(cell) : "";
  return cell.trim();
}

/** The first row, within the first ten, with at least two non-empty cells. */
export function findHeaderRow(cells: readonly (readonly Cell[])[]): number {
  for (let i = 0; i < Math.min(cells.length, 10); i += 1) {
    if ((cells[i] ?? []).filter((cell) => cellText(cell) !== "").length >= 2) return i;
  }
  return 0;
}

export function guessColumns(cells: readonly (readonly Cell[])[]): ColumnChoice {
  const headerRow = findHeaderRow(cells);
  const headers = (cells[headerRow] ?? []).map(cellText);

  const indexOf = (test: (header: string) => boolean): number | null => {
    const found = headers.findIndex((header) => header !== "" && test(header));
    return found === -1 ? null : found;
  };

  const phone = indexOf((h) => PHONE_WORDS.test(h) && !/email|e-mail/i.test(h));
  const first = indexOf((h) => FIRST_WORDS.test(h) && !NOT_NAME.test(h));
  const last = indexOf((h) => LAST_WORDS.test(h) && !NOT_NAME.test(h) && !/last\s*(visit|seen|order|date)/i.test(h));
  const whole = indexOf((h) => NAME_WORDS.test(h) && !NOT_NAME.test(h) && !FIRST_WORDS.test(h) && !LAST_WORDS.test(h) && h !== headers[phone ?? -1]);

  if (first !== null) return { headerRow, name: first, lastName: last, phone };
  return { headerRow, name: whole, lastName: null, phone };
}

export function columnLabels(cells: readonly (readonly Cell[])[], headerRow: number): string[] {
  const width = Math.max(0, ...cells.map((row) => row.length));
  const headers = cells[headerRow] ?? [];
  return Array.from({ length: width }, (_, index) => {
    const letter = columnLetter(index);
    const header = cellText(headers[index]);
    return header ? `${header} (${letter})` : `Column ${letter}`;
  });
}

export function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * The rows to send, in sheet order. Fully blank rows are dropped (they are
 * not people); a row with a name but no phone is kept so the owner is told
 * about it rather than having it vanish.
 */
export function extractRows(cells: readonly (readonly Cell[])[], choice: ColumnChoice): ListRow[] {
  const rows: ListRow[] = [];
  for (let i = choice.headerRow + 1; i < cells.length; i += 1) {
    const row = cells[i] ?? [];
    const first = choice.name === null ? "" : cellText(row[choice.name]);
    const last = choice.lastName === null ? "" : cellText(row[choice.lastName]);
    const phone = choice.phone === null ? "" : cellText(row[choice.phone]);
    const name = [first, last].filter(Boolean).join(" ").slice(0, 200);
    if (!name && !phone) continue;
    rows.push({ row: i + 1, name: name || null, phone: phone ? phone.slice(0, 40) : null });
  }
  return rows;
}
