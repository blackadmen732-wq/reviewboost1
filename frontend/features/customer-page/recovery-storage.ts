import {
  initialCustomerPageState,
  type CustomerPageState,
  type SavePhase,
} from "@/features/customer-page/customer-page-state";
import { isLocale } from "@/lib/i18n/config";
import type { RatingValue } from "@/lib/i18n/customer-messages";

/**
 * Same-tab recovery for a rating that has not landed yet.
 *
 * The failure this exists for: a customer taps four stars on a bad connection,
 * the save is still in flight, and the browser reloads the page — a background
 * tab reclaimed on iOS, a dropped network, a stray pull-to-refresh. Without this
 * the rating is gone and they have no idea, because to them the tap already
 * happened.
 *
 * Session storage, not local: it is scoped to the tab and cleared when the tab
 * closes, which matches how long the thing being recovered is meaningful. The
 * idempotency keys travel with it, so recovering and retrying still produces one
 * rating rather than two.
 */

const storageVersion = 2;

interface StoredDraft extends CustomerPageState {
  version: typeof storageVersion;
}

function storageKey(token: string): string {
  return `reviewboost:customer-page:${token}`;
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isRating(value: unknown): value is RatingValue | null {
  return (
    value === null ||
    value === 1 ||
    value === 2 ||
    value === 3 ||
    value === 4 ||
    value === 5
  );
}

function isPhase(value: unknown): value is SavePhase {
  return (
    value === "idle" ||
    value === "saving" ||
    value === "failed" ||
    value === "offline" ||
    value === "saved"
  );
}

function parseStoredDraft(value: string): CustomerPageState | null {
  try {
    const draft = JSON.parse(value) as Partial<StoredDraft>;
    if (
      draft.version !== storageVersion ||
      !isRating(draft.rating) ||
      !isPhase(draft.phase) ||
      !isStringOrNull(draft.sessionId) ||
      !isStringOrNull(draft.responseId) ||
      !isStringOrNull(draft.sessionKey) ||
      !isStringOrNull(draft.responseKey) ||
      !isStringOrNull(draft.googleClickKey) ||
      typeof draft.googleClickPending !== "boolean" ||
      !isLocale(draft.locale)
    ) {
      return null;
    }

    // A save that was in flight when the page went away has an unknown outcome,
    // so it is restored as a failure with the stars still filled: the customer
    // sees their rating and one button, and the retry reuses the same key.
    return {
      rating: draft.rating,
      phase: draft.phase === "saving" ? "failed" : draft.phase,
      // Describes a save that is no longer running, whatever was stored.
      saveIsSlow: false,
      sessionId: draft.sessionId,
      responseId: draft.responseId,
      sessionKey: draft.sessionKey,
      responseKey: draft.responseKey,
      googleClickKey: draft.googleClickKey,
      googleClickPending: draft.googleClickPending,
      locale: draft.locale,
    };
  } catch {
    return null;
  }
}

export function loadCustomerDraft(token: string): CustomerPageState | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(storageKey(token));
    return value ? parseStoredDraft(value) : null;
  } catch {
    return null;
  }
}

export function saveCustomerDraft(token: string, state: CustomerPageState): void {
  if (typeof window === "undefined") return;
  try {
    const draft: StoredDraft = { version: storageVersion, ...state };
    window.sessionStorage.setItem(storageKey(token), JSON.stringify(draft));
  } catch {
    // Private browsing and storage policies can disable session storage. The
    // flow still works in memory; it just cannot promise recovery.
  }
}

export function clearCustomerDraft(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey(token));
  } catch {
    // In-memory state has already been cleared by the caller.
  }
}

export function safeInitialCustomerState(): CustomerPageState {
  return { ...initialCustomerPageState };
}
