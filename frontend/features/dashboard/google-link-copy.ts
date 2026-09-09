/**
 * Google review link — the one address every Tag uses.
 *
 * A wrong paste does not break one sticker. It sends every customer,
 * from every Tag, to the wrong Google page.
 */

export const GOOGLE_LINK_BLAST =
  "Every Tag uses this one link. A wrong address sends every customer to the wrong Google page.";

export const GOOGLE_LINK_EMPTY = "Not set yet — Tags cannot send people to Google";

export const GOOGLE_LINK_HELP_STEPS = [
  "Open your business on Google",
  "Tap “Ask for reviews”",
  "Copy the link and paste it here",
] as const;

export function canOpenGoogleReviewUrl(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("https://");
}
