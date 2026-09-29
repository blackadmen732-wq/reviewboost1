import "server-only";

import { ConfigError } from "@/lib/server/env";
import { classifyKeyword } from "@/lib/server/sms/keywords";
import { computeSegments } from "@/lib/server/sms/segments";

/**
 * The exact text a customer receives.
 *
 * ONE FUNCTION BUILDS IT, AND EVERYTHING ELSE USES THAT RESULT
 * -------------------------------------------------------------
 * The preview counts segments on the string this returns. The schedule
 * reserves credit on that same string, encrypts it, and stores it. Dispatch
 * decrypts it and hands it to the provider unchanged. So the body Twilio
 * receives is byte-for-byte the body the owner was shown and billed for —
 * there is no second place that appends a footer or rewrites a link.
 *
 * WHAT EVERY MESSAGE CARRIES
 * --------------------------
 *   <Business>: <the owner's message, with the Tag link> <opt-out>
 *
 * The business is named first because a text from an unknown number that
 * does not say who it is from is exactly what carriers filter and customers
 * report. The opt-out names a keyword the inbound handler actually honours,
 * so "Reply STOP" cannot drift from what STOP does.
 *
 * Provider-side rewriting (a Messaging Service's link shortener or opt-out
 * footer) would break that equality and must stay off — docs/backend/
 * TEXT_REQUESTS.md §10. Smart Encoding can only lower the segment count, so
 * it never makes the reservation short.
 */

export const DEFAULT_TEMPLATE = "How was your visit? Tap here to leave a review: {{link}}";

/**
 * The default opt-out copy. Short, GSM-7, and in the form CTIA and the
 * carriers expect for a one-off, customer-initiated message.
 */
export const DEFAULT_OPT_OUT_FOOTER = "Reply STOP to opt out.";

/** Twilio's hard limit on a message body. */
export const MAX_BODY_CHARACTERS = 1600;

const MAX_BUSINESS_NAME = 40;
const MAX_FOOTER = 80;

export interface MessagingConfig {
  optOutFooter: string;
}

/**
 * The opt-out copy for the live messaging configuration.
 *
 * `SMS_OPT_OUT_FOOTER` exists for the case where the registered campaign's
 * sample messages use different wording (A2P 10DLC and toll-free verification
 * both compare live traffic against what was registered). Whatever it says,
 * it must tell the customer to reply with a word that really opts them out,
 * and it must be GSM-7 — a footer with a curly apostrophe would silently
 * switch every message to UCS-2 and more than double its cost.
 */
export function messagingConfig(): MessagingConfig {
  const raw = process.env.SMS_OPT_OUT_FOOTER?.trim();
  const footer = raw && raw.length > 0 ? raw : DEFAULT_OPT_OUT_FOOTER;

  if (footer.length > MAX_FOOTER) {
    throw new ConfigError(`SMS_OPT_OUT_FOOTER must be at most ${MAX_FOOTER} characters.`);
  }
  if (computeSegments(footer).encoding !== "gsm7") {
    throw new ConfigError("SMS_OPT_OUT_FOOTER must use only GSM-7 characters.");
  }
  const namesAStopKeyword = footer
    .split(/[^A-Za-z0-9]+/)
    .some((word) => word === word.toUpperCase() && classifyKeyword(word) === "stop");
  if (!namesAStopKeyword) {
    throw new ConfigError(
      "SMS_OPT_OUT_FOOTER must name an opt-out keyword in capitals, e.g. \"Reply STOP to opt out.\"",
    );
  }

  return { optOutFooter: footer };
}

/**
 * The business's name as it may appear in a text: one line, no control
 * characters, and short enough to leave room for the message.
 */
export function smsBusinessName(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .normalize("NFC")
    // Control characters and line breaks: a name is one line.
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned === "") return null;

  const codePoints = Array.from(cleaned);
  if (codePoints.length <= MAX_BUSINESS_NAME) return cleaned;
  return codePoints.slice(0, MAX_BUSINESS_NAME).join("").trimEnd();
}

export class MessageCompositionError extends Error {
  constructor(
    readonly reason: "missing_business_name" | "body_too_long",
    message: string,
  ) {
    super(message);
    this.name = "MessageCompositionError";
  }
}

/**
 * Build the final body.
 *
 * The owner's template supplies the middle; the business name and the opt-out
 * are not theirs to remove. A template that already opens with the business
 * name is not prefixed a second time.
 */
export function composeTextRequestBody(input: {
  businessName: string | null | undefined;
  link: string;
  template?: string | undefined;
  config?: MessagingConfig;
}): string {
  const business = smsBusinessName(input.businessName);
  if (!business) {
    throw new MessageCompositionError(
      "missing_business_name",
      "Add your business name before sending a Text Request — every message has to say who it is from.",
    );
  }

  const config = input.config ?? messagingConfig();
  const middle = (input.template ?? DEFAULT_TEMPLATE)
    .replace(/\{\{link\}\}/g, input.link)
    .replace(/\s+$/u, "");

  const identified = middle.startsWith(business) ? middle : `${business}: ${middle}`;
  const body = `${identified} ${config.optOutFooter}`;

  if (body.length > MAX_BODY_CHARACTERS) {
    throw new MessageCompositionError(
      "body_too_long",
      "That message is too long to send as a text. Shorten it and try again.",
    );
  }

  return body;
}
