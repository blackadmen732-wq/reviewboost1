/**
 * The words a Text Request may carry, and the words every one of them ends with.
 *
 * Shared by the composer (to show the owner exactly what will be sent) and the
 * server (which assembles the real message). There is no free-text option: a
 * review request that an owner can rewrite at will can become "20% off if you
 * leave 5 stars", which is both review gating and marketing. Changing the
 * approved words is a reviewed change to this file.
 *
 * Every message is framed the same way, by the server, whatever template is
 * chosen:
 *
 *   {Business}: {template, with the Tag link}
 *   Reply STOP to opt out.
 *
 * The business name says who is texting; the last line says how to make it
 * stop. Both count toward the segment total, because both are sent.
 */

export const TEXT_REQUEST_TEMPLATES = {
  thanks_v1: "Thanks for visiting today. How did we do? {{link}}",
  quick_v1: "How was your visit? Tell us here: {{link}}",
} as const;

export type TextRequestTemplateId = keyof typeof TEXT_REQUEST_TEMPLATES;

export const TEXT_REQUEST_TEMPLATE_IDS = Object.keys(TEXT_REQUEST_TEMPLATES) as [
  TextRequestTemplateId,
  ...TextRequestTemplateId[],
];

export const DEFAULT_TEXT_REQUEST_TEMPLATE_ID: TextRequestTemplateId = "thanks_v1";

export const OPT_OUT_LINE = "Reply STOP to opt out.";

/** Long enough for a real business name, short enough not to cost a segment on its own. */
export const SENDER_NAME_MAX = 30;

/**
 * The business name as it appears at the start of a text: control characters
 * and line breaks removed, whitespace collapsed, cut to SENDER_NAME_MAX
 * characters (by code point, so an emoji is never split). Empty when nothing
 * printable is left.
 */
export function senderName(businessName: string): string {
  const cleaned = businessName
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(cleaned).slice(0, SENDER_NAME_MAX).join("").trim();
}

/** The exact text a customer receives. */
export function renderTextRequest(input: {
  businessName: string;
  templateId: TextRequestTemplateId;
  link: string;
}): string {
  const sender = senderName(input.businessName);
  if (!sender) throw new Error("A Text Request needs the business name.");
  const body = TEXT_REQUEST_TEMPLATES[input.templateId].replace(/\{\{link\}\}/g, input.link);
  return `${sender}: ${body}\n${OPT_OUT_LINE}`;
}

/**
 * How an owner says a customer agreed to hear from them. Recorded with the
 * consent, so "who said this person agreed, how, and to what wording" has an
 * answer later.
 */
export const CONSENT_METHODS = {
  in_person: "They agreed in person",
  signup_form: "On a sign-up form",
  at_booking: "When they booked",
  by_text: "By text",
} as const;

export type ConsentMethod = keyof typeof CONSENT_METHODS;

export const CONSENT_METHOD_IDS = Object.keys(CONSENT_METHODS) as [
  ConsentMethod,
  ...ConsentMethod[],
];

/**
 * The statement the owner confirms. Versioned: changing the words means a new
 * version, and consent already recorded keeps the version it was given under.
 */
export const CONSENT_ATTESTATION_VERSION = "owner-attestation-v1";

export function consentAttestationText(businessName: string): string {
  const sender = senderName(businessName) || "this business";
  return `I confirm this customer agreed to receive a text from ${sender} asking about their visit.`;
}
