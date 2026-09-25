/**
 * Google review link — the one address every Tag uses.
 *
 * A wrong paste does not break one sticker. It sends every customer,
 * from every Tag, to the wrong Google page.
 */

import { isValidatedGoogleReviewUrl } from "@/lib/security/google-review-url";

export type GoogleLinkState = "missing" | "invalid" | "valid";

export const GOOGLE_LINK_BLAST =
  "Every Tag at this place uses this link. A wrong address sends every customer who taps one to the wrong Google page.";

export const GOOGLE_LINK_EMPTY = "Not set yet — Tags cannot send people to Google";

export const GOOGLE_LINK_INVALID =
  "This is not a Google review link. Tags will not send people to the right page.";

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
  return isValidatedGoogleReviewUrl(trimmed) ? "valid" : "invalid";
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

export function canOpenGoogleReviewUrl(value: string): boolean {
  return googleLinkState(value) === "valid";
}

/** Opens only a validated Google review link. Never a quiet no-op. */
export function openGoogleReviewUrl(value: string): GoogleLinkState {
  const state = googleLinkState(value);
  if (state === "valid" && typeof window !== "undefined") {
    window.open(value.trim(), "_blank", "noopener,noreferrer");
  }
  return state;
}
