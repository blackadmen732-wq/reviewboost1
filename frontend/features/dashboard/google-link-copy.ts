/**
 * Google review link — the one address every Tag uses.
 *
 * A wrong paste does not break one sticker. It sends every customer,
 * from every Tag, to the wrong Google page.
 */

import { isGoogleReviewWritingUrl, isValidatedGoogleReviewUrl } from "@/lib/security/google-review-url";

/**
 * - valid:   a direct review-writing link (search.google.com/local/writereview
 *            or g.page/r/…/review).
 * - legacy:  a Google Maps listing or short link saved before review links were
 *            required. It still works — Tags keep sending customers to it — but
 *            it opens the listing, not the review box, and cannot be saved
 *            again. The owner is asked to upgrade it; nothing is broken.
 * - invalid: not something any Tag will send a customer to.
 */
export type GoogleLinkState = "missing" | "invalid" | "legacy" | "valid";

export const GOOGLE_LINK_BLAST =
  "Every Tag at this place uses this link. A wrong address sends every customer who taps one to the wrong Google page.";

export const GOOGLE_LINK_EMPTY = "Not set yet — Tags cannot send people to Google";

export const GOOGLE_LINK_INVALID =
  "This is not a Google review link. Tags will not send people to the right page.";

export const GOOGLE_LINK_LEGACY_TITLE = "Upgrade this link";

export const GOOGLE_LINK_LEGACY =
  "This link still works, so your Tags keep working. But it opens your Google listing, not the review box. Replace it with your “Ask for reviews” link so customers land straight on writing a review. Your printed codes and NFC Tags stay the same.";

/** A listing or short link pasted as a new link: it cannot be saved any more. */
export const GOOGLE_LINK_NOT_REVIEW_LINK =
  "This opens your Google listing, not the review box. Paste your “Ask for reviews” link instead.";

export const GOOGLE_LINK_LATER =
  "The Google link is not set. Customers can rate you. They cannot be sent to Google until you add it in Settings.";

export const GOOGLE_LINK_HELP_STEPS = [
  "Open your business on Google",
  "Tap “Ask for reviews”",
  "Copy the link and paste it here",
] as const;

export function googleLinkState(value: string | null | undefined): GoogleLinkState {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "missing";
  if (isGoogleReviewWritingUrl(trimmed)) return "valid";
  return isValidatedGoogleReviewUrl(trimmed) ? "legacy" : "invalid";
}

export function googleLinkDisplay(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed || GOOGLE_LINK_EMPTY;
}

export function googleLinkRefusal(state: GoogleLinkState): string | null {
  if (state === "missing") return GOOGLE_LINK_EMPTY;
  if (state === "invalid") return GOOGLE_LINK_INVALID;
  return null;
}

/** Whether Tags send customers to this link today — a legacy link still does. */
export function googleLinkWorks(state: GoogleLinkState): boolean {
  return state === "valid" || state === "legacy";
}

export function canOpenGoogleReviewUrl(value: string): boolean {
  return googleLinkWorks(googleLinkState(value));
}

/** Opens only a link Tags actually use. Never a quiet no-op. */
export function openGoogleReviewUrl(value: string): GoogleLinkState {
  const state = googleLinkState(value);
  if (googleLinkWorks(state) && typeof window !== "undefined") {
    window.open(value.trim(), "_blank", "noopener,noreferrer");
  }
  return state;
}
