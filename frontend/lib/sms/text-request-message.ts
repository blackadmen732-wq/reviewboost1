/**
 * The words of a Text Request, shared by the server that sends it and the
 * owner screen that previews it, so the preview cannot drift from the text.
 *
 * `{{link}}` is the server's placeholder for the Tag's link. Owners never see
 * or type it: they write their words, and the link goes at the end.
 */

export const TEXT_REQUEST_LINK = "{{link}}";

export const DEFAULT_TEXT_REQUEST_TEMPLATE = `How was your visit? Tap here to leave a review: ${TEXT_REQUEST_LINK}`;

/** The words before the link in the default message. */
export const DEFAULT_TEXT_REQUEST_WORDS = DEFAULT_TEXT_REQUEST_TEMPLATE.replace(
  TEXT_REQUEST_LINK,
  "",
).trim();

/**
 * What to send as `messageTemplate` for what the owner typed. Empty means the
 * server default. Words without the placeholder get the link at the end; a
 * template that already carries it is sent as written.
 */
export function templateFromOwnerWords(words: string): string | undefined {
  const trimmed = words.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes(TEXT_REQUEST_LINK)) return trimmed;
  return `${trimmed} ${TEXT_REQUEST_LINK}`;
}

/**
 * The message split around the link, for showing it as the customer will read
 * it. `after` is only non-empty when an owner placed the link mid-message.
 */
export function previewParts(words: string): { before: string; after: string } {
  const template = templateFromOwnerWords(words) ?? DEFAULT_TEXT_REQUEST_TEMPLATE;
  const index = template.indexOf(TEXT_REQUEST_LINK);
  return {
    before: template.slice(0, index).trimEnd(),
    after: template.slice(index + TEXT_REQUEST_LINK.length).trimStart(),
  };
}
