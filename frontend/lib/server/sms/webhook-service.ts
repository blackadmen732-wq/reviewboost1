import "server-only";

import { encrypt, keyedDigest } from "@/lib/server/crypto";
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
  // means a misrouted or forged request and never verifies.
  const providerName = input.provider.toLowerCase();
  const webhookInput = { url: input.url, headers: input.headers, rawBody: input.rawBody };
  const signatureVerified =
    provider.name === providerName ? provider.verifySignature(webhookInput) : false;

  // Verify BEFORE claiming the deduplicated inbox namespace. An unverified
  // request must never occupy a real provider event's (provider, dedupe_key):
  // if it did, the authentic retry would be seen as a duplicate and its STOP or
  // delivery-status processing silently skipped. Unverified payloads are still
  // captured for forensics, under a separate `unverified:` namespace, then
  // rejected.
  if (!signatureVerified) {
    const dedupeKey = `unverified:${keyedDigest(input.rawBody, "sms_webhook_unverified").slice(0, 48)}`;
    const { error: unvError } = await svc.rpc("rpc_sms_webhook_receive", {
      p_provider: providerName,
      p_provider_event_id: null,
      p_dedupe_key: dedupeKey,
      p_event_type: "unverified",
      p_signature_verified: false,
      p_headers: redactHeaders(input.headers),
      p_raw_body_encrypted: encrypt(input.rawBody),
    });
    if (unvError) {
      logger.error("sms.webhook_unverified_capture_failed", { error: unvError });
    }
    return { accepted: false, duplicate: false, action: "unverified" };
  }

  const parsed = provider.parseWebhook(webhookInput);

  // Durable, deduplicated write BEFORE any business processing. `inserted` is
  // true for a first receipt AND for a retry of an event that never reached a
  // 'processed' outcome (so a transient failure can be repaired); it is false
  // only for a genuine, already-processed duplicate.
  const { data: received, error: receiveError } = await svc.rpc("rpc_sms_webhook_receive", {
    p_provider: providerName,
    p_provider_event_id: "providerEventId" in parsed ? (parsed.providerEventId ?? null) : null,
    p_dedupe_key: parsed.dedupeKey,
    p_event_type: parsed.kind,
    p_signature_verified: true,
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

  // Settle the inbox row as processed, and surface any failure: if the durable
  // "processed" write is lost, the row stays reclaimable and a provider retry
  // will reprocess it, rather than being acknowledged and skipped forever.
  const settleProcessed = async () => {
    const { error } = await svc.rpc("rpc_sms_webhook_settle", {
      p_id: inboxId,
      p_status: "processed",
      p_org_id: null,
      p_error: null,
    });
    if (error) throw error;
  };

  try {
    if (parsed.kind === "delivery_status") {
      if (parsed.terminal) {
        const { data, error } = await svc.rpc("rpc_sms_apply_delivery_status", {
          p_provider: providerName,
          p_provider_message_id: parsed.providerMessageId,
          p_terminal: parsed.terminal,
          p_error_class: parsed.errorClass ?? null,
        });
        if (error) throw error;
        // Receipt arrived before the attempt was settled (race). Keep the
        // inbox row in 'received' so a provider retry can reprocess it once
        // the attempt exists — do NOT mark it processed.
        const result = typeof data === "string" ? data : Array.isArray(data) ? data[0] : data;
        if (result === "no_matching_attempt") {
          const { error: settleErr } = await svc.rpc("rpc_sms_webhook_settle", {
            p_id: inboxId,
            p_status: "received",
            p_org_id: null,
            p_error: "unmatched_receipt",
          });
          if (settleErr) throw settleErr;
          return { accepted: true, duplicate: false, action: "delivery_status" };
        }
      }
      await settleProcessed();
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
      await settleProcessed();
      return {
        accepted: true,
        duplicate: false,
        action: intent === "none" ? "inbound_other" : "inbound_keyword",
      };
    }

    await settleProcessed();
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
