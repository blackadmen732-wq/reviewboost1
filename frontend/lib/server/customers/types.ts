import "server-only";

/**
 * The source-adapter contract every customer integration implements.
 *
 * A ReviewBoost business has ONE customer list regardless of source: manual
 * entry, CSV upload, Google Sheets, Square, Toast, Clover, Vagaro, Housecall
 * Pro. To keep it that way, every source that produces customer rows normalises
 * them into the same shape (`NormalizedCustomerRow`) and hands them to the same
 * import pipeline (`normalize → validate → dedupe → match/create → link →
 * visit`). There is no per-source customers table anywhere.
 *
 * A new POS connector is a new adapter — nothing downstream changes.
 */

export type CustomerSourceKind =
  | "manual"
  | "csv"
  | "google_sheets"
  | "square"
  | "toast"
  | "clover"
  | "vagaro"
  | "housecall_pro"
  | "other";

/**
 * One row a source produced, in the shape the pipeline can consume. Phone is
 * the primary identity — email is optional (nice to have for future channels),
 * but a row without a phone is invalid because Text Requests routes on phone.
 */
export interface NormalizedCustomerRow {
  externalId: string | null;
  displayName: string | null;
  rawPhone: string | null;
  rawEmail: string | null;
  /** Best-effort visit/interaction timestamp from the source, if known. */
  observedAt: Date | null;
  /** Adapter-provided metadata (loose per source; never a raw PII value). */
  meta: Record<string, unknown> | null;
}

/**
 * The header/column mapping a caller declares before running a CSV import.
 * The adapter never guesses which column is "phone" — the caller says.
 */
export interface CsvHeaderMapping {
  displayName?: string;
  phone?: string;
  email?: string;
  externalId?: string;
  observedAt?: string;
}

export type ImportRowAction = "imported" | "matched" | "duplicate" | "invalid" | "skipped";

export interface ImportRowOutcome {
  rowNumber: number;
  action: ImportRowAction;
  externalId: string | null;
  matchedCustomerId: string | null;
  error: string | null;
}

export interface ImportCounts {
  total: number;
  imported: number;
  matched: number;
  duplicate: number;
  invalid: number;
  skipped: number;
  unknownConsent: number;
}

/**
 * The contract every source-side adapter conforms to. Discover the schema
 * (`discover`), pull normalised rows (`fetch`), and record a cursor
 * (`checkpoint`) so a re-sync doesn't re-import everything. Manual entry uses
 * a trivial in-memory adapter; CSV uses the real parser; POS connectors write
 * to the same interface without touching the pipeline.
 */
export interface CustomerSourceAdapter {
  readonly kind: CustomerSourceKind;
  /** Fields the source can produce. */
  discover(): Promise<{ fields: string[] }>;
  /** Emit normalised rows. Bounded/streamed by the caller. */
  fetch(): Promise<NormalizedCustomerRow[]>;
}
