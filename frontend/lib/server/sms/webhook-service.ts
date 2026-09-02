import "server-only";

import { encrypt } from "@/lib/server/crypto";
import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";
import { classifyKeyword } from "@/lib/server/sms/keywords";
import { phoneHash } from "@/lib/server/sms/phone";
import { getSmsProvider } from "@/lib/server/sms/provider";
import type { SmsProvider } from "@/lib/server/sms/provider/types";

/**
 * Inbound provider webhook processing.
 *
 * Every event is written to the durable inbox first, keyed by the provider's own
 * event id, so a duplicate delivery is a harmless no-op. Signature verification
 * is recorded but an unverified event never drives business state. Delivery
 * receipts resolve a request's terminal status; inbound messages are classified
 * for STOP / START / HELP and applied to consent. The raw body is stored
 * encrypted because it can contain a phone number.
 */

// Only providers we have an adapter for. An unknown provider is rejected at the
// boundary rather than processed blindly.
const KNOWN_PROVIDERS = new Set(["twilio", "fake"]);

export interface WebhookOutcome {
  accepted: boolean;
  duplicate: boolean;
  action: "delivery_status" | "inbound_keyword" | "inbound_other" | "unverified" | "ignored";
}

// A single redacted header allowlist — never store Authorization or the
// signature secret itself.
const SAFE_HEADER_KEYS = ["content-type", "user-agent", "x-forwarded-for"];

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of SAFE_HEADER_KEYS) {
    const value = headers[key];
    if (value) out[key] = value.slice(0, 200);
  }
  return out;
}

export function isKnownProvider(name: string): boolean {
  return KNOWN_PROVIDERS.has(name);
}

export async function receiveWebhook(input: {
  provider: string;
  url: string;
  headers: Record<string, string>;
  rawBody: string;
}): Promise<WebhookOutcome> {
  const svc = serviceRoleClient();
  const provider: SmsProvider = getSmsProvider();

  // The route [provider] must match the configured provider adapter; a mismatch
  // means a misrouted or forged request.
  const providerName = input.provider.toLowerCase();
  const signatureVerified =
    provider.name === providerName ? provider.verifySignature({ url: input.url, headers: input.headers, rawBody: input.rawBody }) : false;

  const parsed = provider.name === providerName
    ? provider.parseWebhook({ url: input.url, headers: input.headers, rawBody: input.rawBody })
    : ({ kind: "unknown", dedupeKey: `mismatch:${Date.now()}`, raw: {} } as const);

  // Durable, deduplicated write BEFORE any business processing.
  const { data: received, error: receiveError } = await svc.rpc("rpc_sms_webhook_receive", {
    p_provider: providerName,
    p_provider_event_id: "providerEventId" in parsed ? (parsed.providerEventId ?? null) : null,
    p_dedupe_key: parsed.dedupeKey,
    p_event_type: parsed.kind,
    p_signature_verified: signatureVerified,
    p_headers: redactHeaders(input.headers),
    p_raw_body_encrypted: encrypt(input.rawBody),
  });
  if (receiveError) {
    logger.error("sms.webhook_receive_failed", { error: receiveError });
    throw receiveError;
  }

  const row = (Array.isArray(received) ? received[0] : received) as { inbox_id: string; inserted: boolean };
  if (!row.inserted) {
    return { accepted: true, duplicate: true, action: "ignored" };
  }

  const inboxId = row.inbox_id;

  // An unverified event is captured but must not change state.
  if (!signatureVerified) {
    await svc.rpc("rpc_sms_webhook_settle", { p_id: inboxId, p_status: "failed", p_org_id: null, p_error: "signature_unverified" });
    return { accepted: false, duplicate: false, action: "unverified" };
  }

  try {
    if (parsed.kind === "delivery_status") {
      if (parsed.terminal) {
        const { error } = await svc.rpc("rpc_sms_apply_delivery_status", {
          p_provider: providerName,
          p_provider_message_id: parsed.providerMessageId,
          p_terminal: parsed.terminal,
          p_error_class: parsed.errorClass ?? null,
        });
        if (error) throw error;
      }
      await svc.rpc("rpc_sms_webhook_settle", { p_id: inboxId, p_status: "processed", p_org_id: null, p_error: null });
      return { accepted: true, duplicate: false, action: "delivery_status" };
    }

    if (parsed.kind === "inbound_message") {
      const intent = classifyKeyword(parsed.body);
      if (intent !== "none") {
        const { error } = await svc.rpc("rpc_sms_apply_inbound_keyword", {
          p_phone_hash: phoneHash(parsed.from),
          p_intent: intent,
          p_evidence: { keyword: intent, via: providerName },
        });
        if (error) throw error;
      }
      await svc.rpc("rpc_sms_webhook_settle", { p_id: inboxId, p_status: "processed", p_org_id: null, p_error: null });
      return {
        accepted: true,
        duplicate: false,
        action: intent === "none" ? "inbound_other" : "inbound_keyword",
      };
    }

    await svc.rpc("rpc_sms_webhook_settle", { p_id: inboxId, p_status: "processed", p_org_id: null, p_error: null });
    return { accepted: true, duplicate: false, action: "ignored" };
  } catch (error) {
    logger.error("sms.webhook_process_failed", { inboxId, error });
    await svc.rpc("rpc_sms_webhook_settle", {
      p_id: inboxId,
      p_status: "failed",
      p_org_id: null,
      p_error: error instanceof Error ? error.message : "processing_failed",
    });
    throw error;
  }
}
