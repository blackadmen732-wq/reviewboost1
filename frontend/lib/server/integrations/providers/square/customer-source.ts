import "server-only";

import { z } from "zod";

import type { CanonicalCustomerInput } from "@/lib/server/integrations/types";

/**
 * Square CUSTOMER CONTACTS ONLY.
 *
 * This is the read-only, paginated API boundary for the future Square OAuth
 * connector. It does not read payments, bookings, cards, or consent, and it
 * never sends SMS. The caller must supply a seller-authorized OAuth token.
 *
 * Do not turn Square's directory card on until the OAuth callback, encrypted
 * token storage, import pipeline and sandbox checks are complete.
 *
 * Square reference: https://developer.squareup.com/reference/square/customers-api/ListCustomers
 */
export const SQUARE_CONTACTS_SCOPE = "CUSTOMERS_READ";
export const SQUARE_CUSTOMERS_API_VERSION = "2026-09-16";
const MAX_CURSOR_LENGTH = 4096;

const SquareCustomer = z.object({
  id: z.string().min(1),
  given_name: z.string().nullish(),
  family_name: z.string().nullish(),
  company_name: z.string().nullish(),
  phone_number: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  version: z.number().int().nonnegative().nullish(),
});

const SquarePage = z.object({
  customers: z.array(SquareCustomer).optional(),
  cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).optional(),
});

export type SquareContactErrorReason =
  | "authorization_required"
  | "rate_limited"
  | "temporary_unavailable"
  | "invalid_response";

export class SquareContactError extends Error {
  constructor(public readonly reason: SquareContactErrorReason) {
    // No response body, token, customer name or number is ever logged.
    super(`Square customers unavailable: ${reason}`);
    this.name = "SquareContactError";
  }
}

function dateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const result = new Date(value);
  return Number.isNaN(result.getTime()) ? null : result;
}

function present(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

export function toSquareContact(record: z.infer<typeof SquareCustomer>): CanonicalCustomerInput {
  const name = [present(record.given_name), present(record.family_name)].filter(Boolean).join(" ");
  return {
    externalId: record.id,
    name: name || present(record.company_name),
    phone: present(record.phone_number),
    sourceCreatedAt: dateOrNull(record.created_at),
    sourceUpdatedAt: dateOrNull(record.updated_at),
    sourceVersion: record.version ?? null,
  };
}

export interface ReadSquareContactsInput {
  accessToken: string;
  environment: "sandbox" | "production";
  cursor?: string | null;
  /** 1–100 as required by Square's ListCustomers endpoint. */
  limit?: number;
  /** Injected to test the HTTP boundary without any real Square requests. */
  fetchImpl?: typeof fetch;
}

export interface SquareContactPage {
  customers: CanonicalCustomerInput[];
  nextCursor: string | null;
}

export async function readSquareContactPage(input: ReadSquareContactsInput): Promise<SquareContactPage> {
  if (!input.accessToken.trim()) throw new SquareContactError("authorization_required");
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("Square page limit must be between 1 and 100");
  }
  if (input.cursor && input.cursor.length > MAX_CURSOR_LENGTH) {
    throw new RangeError("Square pagination cursor is too long");
  }

  const base = input.environment === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
  const url = new URL("/v2/customers", base);
  url.searchParams.set("limit", String(limit));
  if (input.cursor) url.searchParams.set("cursor", input.cursor);

  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(url.toString(), {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${input.accessToken}`,
        "Square-Version": SQUARE_CUSTOMERS_API_VERSION,
        "Accept": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new SquareContactError("temporary_unavailable");
  }

  if (response.status === 401 || response.status === 403) {
    throw new SquareContactError("authorization_required");
  }
  if (response.status === 429) throw new SquareContactError("rate_limited");
  if (response.status >= 500) throw new SquareContactError("temporary_unavailable");
  if (!response.ok) throw new SquareContactError("invalid_response");

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SquareContactError("invalid_response");
  }
  const parsed = SquarePage.safeParse(body);
  if (!parsed.success) throw new SquareContactError("invalid_response");

  return {
    customers: (parsed.data.customers ?? []).map(toSquareContact),
    nextCursor: parsed.data.cursor ?? null,
  };
}
