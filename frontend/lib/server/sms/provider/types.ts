import "server-only";

/**
 * The SMS provider boundary.
 *
 * Domain code depends on this interface, never on a vendor SDK. Swapping Twilio
 * for another gateway is implementing this interface once, not editing the
 * pipeline. A deterministic fake implements it too, so every state-machine and
 * idempotency test runs without a network or an account.
 */

export type SendOutcome = "submitted" | "failed" | "provider_unknown";

/**
 * Normalised, vendor-independent error classes. A handler and the quota logic
 * branch on these, never on a raw provider code, so a new provider's codes are
 * mapped in one place.
 */
export type SmsErrorClass =
  | "invalid_number"
  | "unsubscribed"
  | "rate_limited"
  | "carrier_rejected"
  | "insufficient_funds"
  | "timeout"
  | "provider_error"
  | "unknown";

export interface SendParams {
  /** E.164. Only ever present at the moment of sending, decrypted in memory. */
  to: string;
  body: string;
  /** Idempotency token passed to providers that honour one. */
  idempotencyKey?: string;
}

export interface SendResult {
  outcome: SendOutcome;
  providerMessageId?: string;
  errorClass?: SmsErrorClass;
  /** Safe, redacted provider metadata only — never the body or credentials. */
  raw: Record<string, unknown>;
}

export interface WebhookInput {
  /** The absolute URL the provider POSTed to, needed for signature schemes. */
  url: string;
  headers: Record<string, string>;
  rawBody: string;
}

export type ParsedWebhook =
  | {
      kind: "delivery_status";
      providerEventId: string | null;
      dedupeKey: string;
      providerMessageId: string;
      terminal: "delivered" | "failed" | null;
      errorClass?: SmsErrorClass;
      raw: Record<string, unknown>;
    }
  | {
      kind: "inbound_message";
      providerEventId: string | null;
      dedupeKey: string;
      from: string;
      body: string;
      providerMessageId: string | null;
      raw: Record<string, unknown>;
    }
  | { kind: "unknown"; dedupeKey: string; raw: Record<string, unknown> };

export interface SmsProvider {
  readonly name: string;
  send(params: SendParams): Promise<SendResult>;
  classifyError(raw: unknown): SmsErrorClass;
  /** True only when the provider signature verifies against configured secrets. */
  verifySignature(input: WebhookInput): boolean;
  parseWebhook(input: WebhookInput): ParsedWebhook;
}
