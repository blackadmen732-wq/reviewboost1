import {
  initialCustomerFlowState,
  type CustomerFlowState,
  type CustomerScreen,
  type SubmissionStatus,
} from "@/features/customer-flow/customer-flow-state";
import { isLocale } from "@/lib/i18n/config";
import type { RatingValue } from "@/lib/i18n/customer-messages";

// Bumped for V1: the stored shape lost `note` and every praise field, and the
// "praise" screen no longer exists. A draft written by the previous build is
// discarded outright rather than shape-checked field by field -- restoring a
// customer onto a screen that is gone is not a recovery.
const storageVersion = 2;

interface StoredCustomerDraft extends CustomerFlowState {
  version: typeof storageVersion;
}

function storageKey(token: string): string {
  return `reviewboost:customer-flow:${token}`;
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isRating(value: unknown): value is RatingValue | null {
  return value === null || value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function isScreen(value: unknown): value is CustomerScreen {
  return value === "rating" || value === "google" || value === "finished";
}

function isStatus(value: unknown): value is SubmissionStatus {
  return value === "idle" || value === "submitting" || value === "error" || value === "offline";
}

function parseStoredDraft(value: string): CustomerFlowState | null {
  try {
    const draft = JSON.parse(value) as Partial<StoredCustomerDraft>;
    if (
      draft.version !== storageVersion ||
      !isScreen(draft.screen) ||
      !isRating(draft.rating) ||
      !isStringOrNull(draft.sessionId) ||
      !isStringOrNull(draft.responseId) ||
      !isStringOrNull(draft.sessionKey) ||
      !isStringOrNull(draft.responseKey) ||
      !isStringOrNull(draft.googleClickKey) ||
      typeof draft.googleClickPending !== "boolean" ||
      !isStatus(draft.feedbackStatus) ||
      !isLocale(draft.locale)
    ) {
      return null;
    }

    if (draft.screen === "google" && (!draft.sessionId || !draft.responseId)) {
      return null;
    }

    return {
      screen: draft.screen,
      rating: draft.rating,
      sessionId: draft.sessionId,
      responseId: draft.responseId,
      sessionKey: draft.sessionKey,
      responseKey: draft.responseKey,
      googleClickKey: draft.googleClickKey,
      googleClickPending: draft.googleClickPending,
      feedbackStatus: draft.feedbackStatus === "submitting" ? "error" : draft.feedbackStatus,
      locale: draft.locale,
    };
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

export function saveCustomerDraft(token: string, state: CustomerFlowState): void {
  if (typeof window === "undefined") return;
  try {
    if (state.screen === "finished") {
      window.sessionStorage.removeItem(storageKey(token));
      return;
    }
    const draft: StoredCustomerDraft = { version: storageVersion, ...state };
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

