import type { Locale } from "@/lib/i18n/config";
import type { RatingValue } from "@/lib/i18n/customer-messages";

/**
 * The whole customer interaction, as state.
 *
 * It is this small because the flow is one step. There is no screen field, no
 * note, no praise draft, and no "which question are we on", because a star tap
 * is the entire decision — a customer who has tapped has finished with
 * ReviewBoost and is on their way to Google.
 */

export type SavePhase = "idle" | "saving" | "failed" | "offline" | "saved";

export interface CustomerPageState {
  rating: RatingValue | null;
  phase: SavePhase;
  /*
   * A save that has been running long enough to be worth mentioning. Part of the
   * state rather than a separate flag so that it cannot outlive the save it
   * describes: every phase transition rewrites it.
   */
  saveIsSlow: boolean;
  sessionId: string | null;
  responseId: string | null;
  /*
   * Idempotency keys are held in state, not generated per attempt, so a retry
   * after a timeout cannot create a second rating for one tap. A key is only
   * discarded when the customer chooses a different star, which is a genuinely
   * different rating.
   */
  sessionKey: string | null;
  responseKey: string | null;
  googleClickKey: string | null;
  googleClickPending: boolean;
  locale: Locale;
}

export const initialCustomerPageState: CustomerPageState = {
  rating: null,
  phase: "idle",
  saveIsSlow: false,
  sessionId: null,
  responseId: null,
  sessionKey: null,
  responseKey: null,
  googleClickKey: null,
  googleClickPending: false,
  locale: "en",
};

export type CustomerPageAction =
  | { type: "restore"; state: CustomerPageState }
  | { type: "select-rating"; rating: RatingValue }
  | { type: "save-started"; sessionKey: string; responseKey: string }
  | { type: "save-is-slow" }
  | { type: "session-ready"; sessionId: string }
  | { type: "save-failed" }
  | { type: "save-offline" }
  | { type: "save-succeeded"; sessionId: string; responseId: string }
  | { type: "google-click-started"; idempotencyKey: string }
  | { type: "google-click-recorded" }
  | { type: "change-locale"; locale: Locale };

export function customerPageReducer(
  state: CustomerPageState,
  action: CustomerPageAction,
): CustomerPageState {
  switch (action.type) {
    case "restore":
      return action.state;

    case "select-rating":
      // Changing the star is a new answer, so the response key goes and the
      // failure clears. The session is the visit and survives.
      return state.rating === action.rating
        ? state
        : {
            ...state,
            rating: action.rating,
            phase: "idle",
            saveIsSlow: false,
            responseId: null,
            responseKey: null,
          };

    case "save-started":
      return {
        ...state,
        phase: "saving",
        saveIsSlow: false,
        sessionKey: action.sessionKey,
        responseKey: action.responseKey,
      };

    case "save-is-slow":
      // Only meaningful while a save is running; a late timer is ignored.
      return state.phase === "saving" ? { ...state, saveIsSlow: true } : state;

    case "session-ready":
      return { ...state, sessionId: action.sessionId };

    case "save-failed":
      // The rating is untouched on purpose. Erasing the stars a customer
      // already tapped is how a product loses the answer *and* the trust.
      return { ...state, phase: "failed", saveIsSlow: false };

    case "save-offline":
      return { ...state, phase: "offline", saveIsSlow: false };

    case "save-succeeded":
      return {
        ...state,
        phase: "saved",
        saveIsSlow: false,
        sessionId: action.sessionId,
        responseId: action.responseId,
      };

    case "google-click-started":
      return {
        ...state,
        googleClickKey: action.idempotencyKey,
        googleClickPending: true,
      };

    case "google-click-recorded":
      return { ...state, googleClickPending: false };

    case "change-locale":
      return { ...state, locale: action.locale };
  }
}
