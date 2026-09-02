import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { ConfigError } from "@/lib/server/env";
import type {
  ParsedWebhook,
  SendParams,
  SendResult,
  SmsErrorClass,
  SmsProvider,
  WebhookInput,
} from "@/lib/server/sms/provider/types";

/**
 * Twilio adapter.
 *
 * The repository names Twilio as the intended gateway, so this maps its API and
 * webhook shapes to the vendor-independent boundary. It commits no credentials,
 * performs no send unless real credentials are configured at runtime, and never
 * fabricates a "verified" webhook — an unconfigured auth token means signature
 * verification returns false, which the inbox records as unverified.
 */

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  from: string; // a From number or a Messaging Service SID (MG...)
}

function readConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_MESSAGING_SERVICE_SID ?? process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !from) return null;
  return { accountSid, authToken, from };
}

export function twilioConfigured(): boolean {
  return readConfig() !== null;
}

// Twilio delivery/error codes → our normalised classes. Extend as needed; the
// default keeps an unmapped code from masquerading as a known one.
function classifyTwilioCode(code: number | undefined): SmsErrorClass {
  switch (code) {
    case 21211:
    case 21614:
      return "invalid_number";
    case 21610:
      return "unsubscribed";
    case 20429:
      return "rate_limited";
    case 30007:
    case 30008:
      return "carrier_rejected";
    case 30006:
      return "carrier_rejected";
    default:
      return code ? "provider_error" : "unknown";
  }
}

export class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio";

  async send(params: SendParams): Promise<SendResult> {
    const config = readConfig();
    if (!config) {
      // Never silently no-op a send: an unconfigured provider is a configuration
      // error the caller must handle, not a dropped message.
      throw new ConfigError("Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / from).");
    }

    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
    const form = new URLSearchParams();
    form.set("To", params.to);
    form.set("Body", params.body);
    if (config.from.startsWith("MG")) form.set("MessagingServiceSid", config.from);
    else form.set("From", config.from);

    const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          ...(params.idempotencyKey ? { "I-Twilio-Idempotency-Token": params.idempotencyKey } : {}),
        },
        body: form.toString(),
        signal: AbortSignal.timeout(15_000),
      });

      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        return {
          outcome: "failed",
          errorClass: classifyTwilioCode(numberOrUndefined(payload.code)),
          raw: { status: response.status, code: payload.code },
        };
      }

      return {
        outcome: "submitted",
        ...(typeof payload.sid === "string" ? { providerMessageId: payload.sid } : {}),
        raw: { status: String(payload.status ?? "queued") },
      };
    } catch (error) {
      // A network timeout after we sent the request is genuine uncertainty: the
      // message may or may not have been accepted. Represent that, do not retry.
      const timedOut = error instanceof Error && /timeout|abort/i.test(error.message);
      return {
        outcome: "provider_unknown",
        errorClass: timedOut ? "timeout" : "provider_error",
        raw: { error: timedOut ? "timeout" : "network_error" },
      };
    }
  }

  classifyError(raw: unknown): SmsErrorClass {
    if (raw && typeof raw === "object" && "code" in raw) {
      return classifyTwilioCode(numberOrUndefined((raw as { code: unknown }).code));
    }
    return "unknown";
  }

  /**
   * Twilio's X-Twilio-Signature scheme: HMAC-SHA1, keyed with the auth token,
   * over the request URL concatenated with each POST parameter's name and value
   * in alphabetical order, base64-encoded. Verification is impossible without
   * the auth token, so an unconfigured provider returns false.
   */
  verifySignature(input: WebhookInput): boolean {
    const config = readConfig();
    if (!config) return false;

    const provided = input.headers["x-twilio-signature"] ?? input.headers["X-Twilio-Signature"];
    if (!provided) return false;

    const params = new URLSearchParams(input.rawBody);
    const sortedKeys = [...params.keys()].sort();
    let data = input.url;
    for (const key of sortedKeys) data += key + (params.get(key) ?? "");

    const expected = createHmac("sha1", config.authToken).update(Buffer.from(data, "utf8")).digest("base64");

    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  parseWebhook(input: WebhookInput): ParsedWebhook {
    const params = new URLSearchParams(input.rawBody);
    const messageSid = params.get("MessageSid") ?? params.get("SmsSid") ?? "";
    const status = params.get("MessageStatus") ?? params.get("SmsStatus");
    const from = params.get("From");
    const body = params.get("Body");

    // Delivery receipt: carries a status for a message we sent.
    if (status && messageSid) {
      const terminal =
        status === "delivered"
          ? "delivered"
          : status === "failed" || status === "undelivered"
            ? "failed"
            : null;
      return {
        kind: "delivery_status",
        providerEventId: messageSid + ":" + status,
        dedupeKey: messageSid + ":" + status,
        providerMessageId: messageSid,
        terminal,
        ...(terminal === "failed"
          ? { errorClass: classifyTwilioCode(numberOrUndefined(params.get("ErrorCode"))) }
          : {}),
        raw: { status },
      };
    }

    // Inbound message: an actual reply (a STOP, a START, or free text).
    if (from !== null && body !== null) {
      return {
        kind: "inbound_message",
        providerEventId: messageSid || null,
        dedupeKey: messageSid || `${from}:${hashShort(body)}`,
        from,
        body,
        providerMessageId: messageSid || null,
        raw: { kind: "inbound" },
      };
    }

    return { kind: "unknown", dedupeKey: hashShort(input.rawBody), raw: {} };
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function hashShort(value: string): string {
  return createHmac("sha256", "twilio_dedupe").update(value).digest("hex").slice(0, 32);
}
