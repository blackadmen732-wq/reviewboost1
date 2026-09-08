import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

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
  /** Numbers whose submit returns a retryable error (429). */
  retryableNumbers?: Set<string>;
  /** Numbers whose submit "times out" — outcome provider_unknown. */
  unknownNumbers?: Set<string>;
}

export class FakeSmsProvider implements SmsProvider {
  readonly name = "fake";
  private readonly failNumbers: Record<string, SmsErrorClass>;
  private readonly retryableNumbers: Set<string>;
  private readonly unknownNumbers: Set<string>;
  public readonly sent: SendParams[] = [];

  constructor(options: FakeProviderOptions = {}) {
    this.failNumbers = options.failNumbers ?? {};
    this.retryableNumbers = options.retryableNumbers ?? new Set();
    this.unknownNumbers = options.unknownNumbers ?? new Set();
  }

  async send(params: SendParams): Promise<SendResult> {
    this.sent.push(params);

    if (this.unknownNumbers.has(params.to)) {
      return { outcome: "provider_unknown", errorClass: "timeout", raw: { simulated: "timeout" } };
    }

    if (this.retryableNumbers.has(params.to)) {
      return { outcome: "retryable", errorClass: "rate_limited", raw: { simulated: "rate_limited" } };
    }

    const failClass = this.failNumbers[params.to];
    if (failClass) {
      return { outcome: "failed", errorClass: failClass, raw: { simulated: failClass } };
    }

    // The provider message id must identify the *logical request*, not just its
    // content: two distinct requests to the same recipient with the same body
    // are different messages and must get different ids, or a delivery receipt
    // could resolve the wrong request. The dispatch idempotency key (`req:<id>`)
    // is exactly that identity — unique per request and stable across an
    // idempotent retry. When no key is supplied (ad-hoc/test sends) fall back to
    // the content so behaviour stays deterministic.
    const identity = params.idempotencyKey ?? `${params.to}|${params.body}`;
    const id = createHash("sha256").update(identity).digest("hex").slice(0, 24);
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

  /**
   * In development and tests the fake trusts its own events. In production —
   * where SMS_PROVIDER=fake is an explicit, supported choice — it must NOT
   * accept every request: an open webhook that changes consent for a guessed
   * number is a real hole. There it requires a shared secret in the
   * `x-fake-signature` header matching SMS_FAKE_WEBHOOK_SECRET, and rejects
   * everything else (including when no secret is configured).
   */
  verifySignature(input: WebhookInput): boolean {
    if (process.env.NODE_ENV !== "production") return true;

    const secret = process.env.SMS_FAKE_WEBHOOK_SECRET;
    if (!secret) return false;

    const provided = input.headers["x-fake-signature"] ?? input.headers["X-Fake-Signature"];
    if (!provided) return false;

    const a = Buffer.from(provided);
    const b = Buffer.from(secret);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
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
