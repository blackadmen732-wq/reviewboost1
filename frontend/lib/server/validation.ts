import "server-only";

import { z } from "zod";

import { ApiError, validationFailed, type FieldError } from "@/lib/server/errors";

/**
 * Request validation for the public customer flow.
 *
 * Every body schema is `strictObject`, which is the published contract's
 * `additionalProperties: false` enforced on the server. An unrecognised field is
 * **rejected, not ignored** — that is what makes "the public flow collects no
 * phone number, email address, or marketing consent" a property the code has
 * rather than a promise the documentation makes. An endpoint that silently
 * discarded them would still be an endpoint someone could be told to start
 * sending them to.
 */

export const SUPPORTED_LOCALES = ["en", "es", "ht"] as const;
export const DEFAULT_LOCALE = "en";

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const MAX_NOTE_LENGTH = 2000;
export const MAX_FIRST_NAME_LENGTH = 80;

/**
 * Byte ceilings on top of the character limits.
 *
 * `maxLength` in the contract counts UTF-16 code units; storage and encryption
 * count bytes. The worst case is 3 bytes per code unit — a 3-byte character
 * like a CJK ideograph is one unit, while a 4-byte emoji is two units and so
 * averages 2 — which makes these exactly the maximum the character limits can
 * produce.
 *
 * With today's limits the character check is therefore always the binding one,
 * and these never fire. They are kept deliberately: if someone raises
 * MAX_NOTE_LENGTH later, the storage bound stays explicit instead of silently
 * tripling. A test asserts the two stay consistent.
 */
export const MAX_NOTE_BYTES = MAX_NOTE_LENGTH * 3;
export const MAX_FIRST_NAME_BYTES = MAX_FIRST_NAME_LENGTH * 3;

export const byteLength = (value: string) => Buffer.byteLength(value, "utf8");

/** Stand token from the URL. Matches the contract's pattern exactly. */
export const tokenSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid review link.");

/** Contract: 16 to 128 characters. */
export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, "Idempotency-Key must be 16-128 URL-safe characters.");

/** Opaque capability tokens the server issued earlier in the flow. */
const opaqueToken = z
  .string()
  .min(16)
  .max(160)
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid token.");

const customerNote = z
  .string()
  .max(MAX_NOTE_LENGTH)
  .refine((value) => byteLength(value) <= MAX_NOTE_BYTES, "Note is too large.");

export const createSessionSchema = z.strictObject({
  locale: z.enum(SUPPORTED_LOCALES),
});

export const submitResponseSchema = z.strictObject({
  sessionId: opaqueToken,
  // Every rating is accepted and stored. Nothing downstream branches on it.
  rating: z.number().int().min(1).max(5),
  // Optional for every rating, including 4 and 5.
  note: customerNote.optional(),
});

export const googleClickSchema = z.strictObject({
  sessionId: opaqueToken,
  responseId: opaqueToken,
});

export const teamPraiseSchema = z.strictObject({
  sessionId: opaqueToken,
  responseId: opaqueToken,
  // Unicode accepted as written. Names are never transliterated.
  firstName: z
    .string()
    .min(1)
    .max(MAX_FIRST_NAME_LENGTH)
    .refine((value) => byteLength(value) <= MAX_FIRST_NAME_BYTES, "Name is too large."),
  note: customerNote.optional(),
});

function toFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "(root)",
    message: issue.message,
  }));
}

/** Parse or throw the contract's validation error. */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw validationFailed(toFieldErrors(result.error));
  return result.data;
}

export function parseTokenOrThrow(value: string): string {
  const result = tokenSchema.safeParse(value);
  // A malformed token cannot correspond to a real stand, so rejecting it early
  // leaks nothing about which stands exist.
  if (!result.success) throw validationFailed([{ field: "token", message: "Invalid review link." }]);
  return result.data;
}

export function parseIdempotencyKeyOrThrow(request: Request): string {
  const raw = request.headers.get("idempotency-key");
  const result = idempotencyKeySchema.safeParse(raw ?? "");

  if (!result.success) {
    // Mandatory rather than optional: the customer flow runs on a phone, so the
    // request that times out is the normal case. A retry without a key would
    // write a second response, praise record, or scan.
    throw new ApiError(400, "validation_failed", "A valid Idempotency-Key header is required.", {
      details: [{ field: "Idempotency-Key", message: result.error.issues[0]?.message ?? "Invalid." }],
    });
  }

  return result.data;
}

/**
 * Canonical request form for the idempotency fingerprint.
 *
 * Keys sorted recursively, so a retry that serialised the same body in a
 * different order — which different JSON serialisers genuinely produce — is
 * recognised as a replay rather than reported as a conflict. Array order is
 * preserved, because array order is meaningful.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (source[key] === undefined) continue;
    result[key] = canonicalize(source[key]);
  }
  return result;
}

/**
 * Normalise customer-entered text.
 *
 * NFC only. The customer's own words are stored as written: nothing here
 * transliterates a name, strips an accent, or rewrites text — a colleague
 * called "José" must reach the owner as "José", and a praise note is evidence,
 * not copy to be edited.
 *
 * C0 control characters other than tab, newline, and carriage return are
 * removed: they carry no meaning in a name or a note and are a display-spoofing
 * vector.
 */
const MEANINGFUL_WHITESPACE = new Set([9, 10, 13]);

export function normalizeCustomerText(value: string | undefined): string {
  if (value === undefined) return "";

  let stripped = "";
  for (const character of value.normalize("NFC")) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 && !MEANINGFUL_WHITESPACE.has(code)) continue;
    if (code === 127) continue;
    stripped += character;
  }

  return stripped.trim();
}
