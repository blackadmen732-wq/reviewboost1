import "server-only";

import { createHash } from "node:crypto";

import type {
  ParsedWebhook,
  SendParams,
  SendResult,
  SmsErrorClass,
  SmsProvider,
  WebhookInput,
} from "@/lib/server/sms/provider/types";

/**
 * A deterministic, network-free SMS provider for tests and local development.
 *
 * The outcome of `send` is fixed by the destination number, so a test can exercise
 * submitted / failed / provider_unknown paths without timing, randomness, or a
 * real account. It never sends anything.
 */

export interface FakeProviderOptions {
  /** Numbers that should return a failed submit, with their error class. */
  failNumbers?: Record<string, SmsErrorClass>;
  /** Numbers whose submit "times out" — outcome provider_unknown. */
  unknownNumbers?: Set<string>;
}

export class FakeSmsProvider implements SmsProvider {
  readonly name = "fake";
  private readonly failNumbers: Record<string, SmsErrorClass>;
  private readonly unknownNumbers: Set<string>;
  public readonly sent: SendParams[] = [];

  constructor(options: FakeProviderOptions = {}) {
    this.failNumbers = options.failNumbers ?? {};
    this.unknownNumbers = options.unknownNumbers ?? new Set();
  }

  async send(params: SendParams): Promise<SendResult> {
    this.sent.push(params);

    if (this.unknownNumbers.has(params.to)) {
      // Submitted to the network, but we never learned the outcome.
      return { outcome: "provider_unknown", errorClass: "timeout", raw: { simulated: "timeout" } };
    }

    const failClass = this.failNumbers[params.to];
    if (failClass) {
      return { outcome: "failed", errorClass: failClass, raw: { simulated: failClass } };
    }

    // A stable, unique-per-(to,body) message id so a re-send is visibly distinct
    // and a webhook can be correlated in tests.
    const id = createHash("sha256").update(`${params.to}|${params.body}`).digest("hex").slice(0, 24);
    return { outcome: "submitted", providerMessageId: `fake_${id}`, raw: { simulated: "submitted" } };
  }

  classifyError(raw: unknown): SmsErrorClass {
    if (raw && typeof raw === "object" && "simulated" in raw) {
      const value = (raw as { simulated: unknown }).simulated;
      if (typeof value === "string") {
        const known: SmsErrorClass[] = [
          "invalid_number", "unsubscribed", "rate_limited", "carrier_rejected",
          "insufficient_funds", "timeout", "provider_error",
        ];
        if (known.includes(value as SmsErrorClass)) return value as SmsErrorClass;
      }
    }
    return "unknown";
  }

  // The fake trusts its own test-issued events; a real provider must not.
  verifySignature(): boolean {
    return true;
  }

  parseWebhook(input: WebhookInput): ParsedWebhook {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(input.rawBody) as Record<string, unknown>;
    } catch {
      return { kind: "unknown", dedupeKey: hashBody(input.rawBody), raw: {} };
    }

    const eventId = typeof payload.eventId === "string" ? payload.eventId : null;
    const dedupeKey = eventId ?? hashBody(input.rawBody);

    if (payload.type === "status" && typeof payload.messageId === "string") {
      const status = String(payload.status);
      const terminal = status === "delivered" ? "delivered" : status === "failed" ? "failed" : null;
      return {
        kind: "delivery_status",
        providerEventId: eventId,
        dedupeKey,
        providerMessageId: payload.messageId,
        terminal,
        ...(typeof payload.errorClass === "string"
          ? { errorClass: payload.errorClass as SmsErrorClass }
          : {}),
        raw: { type: "status", status },
      };
    }

    if (payload.type === "inbound" && typeof payload.from === "string") {
      return {
        kind: "inbound_message",
        providerEventId: eventId,
        dedupeKey,
        from: payload.from,
        body: typeof payload.body === "string" ? payload.body : "",
        providerMessageId: typeof payload.messageId === "string" ? payload.messageId : null,
        raw: { type: "inbound" },
      };
    }

    return { kind: "unknown", dedupeKey, raw: {} };
  }
}

function hashBody(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 32);
}
