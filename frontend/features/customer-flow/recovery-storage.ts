import {
  initialCustomerFlowState,
  persistableState,
  type CustomerFlowState,
  type CustomerScreen,
  type PendingRating,
  type SubmissionStatus,
} from "@/features/customer-flow/customer-flow-state";
import { isLocale } from "@/lib/i18n/config";
import type { RatingValue } from "@/lib/i18n/customer-messages";

/**
 * 3: the tap sends one combined request and the page leaves at once, so a
 * draft carries the pending request rather than server ids. Drafts written by
 * the step-by-step flow (2) are not read: the customer gets a fresh form.
 */
const storageVersion = 3;

interface StoredCustomerDraft extends CustomerFlowState {
  version: typeof storageVersion;
}

function storageKey(token: string): string {
  return `reviewboost:customer-flow:${token}`;
}

function isRatingValue(value: unknown): value is RatingValue {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function isRating(value: unknown): value is RatingValue | null {
  return value === null || isRatingValue(value);
}

function isScreen(value: unknown): value is CustomerScreen {
  return value === "rating" || value === "handoff";
}

function isStatus(value: unknown): value is SubmissionStatus {
  return value === "idle" || value === "leaving" || value === "offline";
}

function isPending(value: unknown): value is PendingRating | null {
  if (value === null) return true;
  if (typeof value !== "object") return false;
  const pending = value as Partial<PendingRating>;
  return (
    typeof pending.key === "string" &&
    pending.key.length >= 16 &&
    isRatingValue(pending.rating) &&
    isLocale(pending.locale)
  );
}

function parseStoredDraft(value: string): CustomerFlowState | null {
  try {
    const draft = JSON.parse(value) as Partial<StoredCustomerDraft>;
    if (
      draft.version !== storageVersion ||
      !isScreen(draft.screen) ||
      !isRating(draft.rating) ||
      !isPending(draft.pending) ||
      !isStatus(draft.feedbackStatus) ||
      !isLocale(draft.locale)
    ) {
      return null;
    }

    // Held offline means a tap is waiting: without it there is nothing to hold.
    if (draft.feedbackStatus === "offline" && !draft.pending) return null;

    return persistableState({
      screen: draft.screen,
      rating: draft.screen === "handoff" ? null : draft.rating,
      pending: draft.pending ? { ...draft.pending } : null,
      feedbackStatus: draft.feedbackStatus,
      locale: draft.locale,
    });
  } catch {
    return null;
  }
}

export function loadCustomerDraft(token: string): CustomerFlowState | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(storageKey(token));
    return value ? parseStoredDraft(value) : null;
  } catch {
    return null;
  }
}

/**
 * The handoff state is kept deliberately.
 *
 * A customer who taps back from the public review page must land on the
 * handoff, not on a fresh rating form they could submit a second time. Keeping
 * the state is what makes the back button harmless, and keeping the pending
 * request is what lets the page finish a save that did not get through. A page
 * caught mid-departure is stored as the handoff it is becoming.
 */
export function saveCustomerDraft(token: string, state: CustomerFlowState): void {
  if (typeof window === "undefined") return;
  try {
    const draft: StoredCustomerDraft = { version: storageVersion, ...persistableState(state) };
    window.sessionStorage.setItem(storageKey(token), JSON.stringify(draft));
  } catch {
    // Private browsing or storage policy can disable sessionStorage. The flow
    // remains usable in memory without claiming durable recovery.
  }
}

export function clearCustomerDraft(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey(token));
  } catch {
    // The in-memory state has still been cleared.
  }
}

export function safeInitialCustomerState(): CustomerFlowState {
  return { ...initialCustomerFlowState };
}
