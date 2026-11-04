import type { Locale } from "@/lib/i18n/config";
import type { RatingValue } from "@/lib/i18n/customer-messages";

/**
 * V1 customer contract: one tap.
 *
 * `rating` is the only screen a customer is ever asked to act on. Tapping a
 * star submits immediately and hands off to the business's public review
 * destination. `handoff` is not a step — it is what the page shows while the
 * browser is already navigating away, and what a customer returning with the
 * back button lands on instead of an empty form they could rate twice.
 */
export type CustomerScreen = "rating" | "handoff";
export type SubmissionStatus = "idle" | "submitting" | "error" | "offline";

export interface CustomerFlowState {
  screen: CustomerScreen;
  rating: RatingValue | null;
  sessionId: string | null;
  responseId: string | null;
  sessionKey: string | null;
  /**
   * The language the session was started in. The session now starts when the
   * page opens, before the customer may switch language, and a retry with the
   * same key must send the same body or the server calls it a conflict.
   */
  sessionLocale: Locale | null;
  responseKey: string | null;
  destinationKey: string | null;
  destinationPending: boolean;
  feedbackStatus: SubmissionStatus;
  locale: Locale;
}

export const initialCustomerFlowState: CustomerFlowState = {
  screen: "rating",
  rating: null,
  sessionId: null,
  responseId: null,
  sessionKey: null,
  sessionLocale: null,
  responseKey: null,
  destinationKey: null,
  destinationPending: false,
  feedbackStatus: "idle",
  locale: "en",
};

export type CustomerFlowAction =
  | { type: "restore"; state: CustomerFlowState }
  | { type: "select-rating"; rating: RatingValue }
  | { type: "change-locale"; locale: Locale }
  | { type: "session-opening"; sessionKey: string; sessionLocale: Locale }
  | { type: "feedback-started"; sessionKey: string; sessionLocale: Locale; responseKey: string }
  | { type: "session-ready"; sessionId: string }
  | { type: "session-replaced"; sessionKey: string; sessionLocale: Locale; responseKey: string }
  | { type: "feedback-offline" }
  | { type: "feedback-failed" }
  | {
      type: "feedback-succeeded";
      sessionId: string;
      responseId: string;
      destinationKey: string;
    }
  | { type: "destination-recorded" };

export function customerFlowReducer(
  state: CustomerFlowState,
  action: CustomerFlowAction,
): CustomerFlowState {
  switch (action.type) {
    case "restore":
      return action.state;
    case "select-rating":
      return {
        ...state,
        rating: action.rating,
        responseKey: null,
        feedbackStatus: "idle",
      };
    case "change-locale":
      return { ...state, locale: action.locale };
    case "session-opening":
      // Once chosen, the key and its language never change: a reload or a
      // retry is the same session, not a second open.
      return {
        ...state,
        sessionKey: state.sessionKey ?? action.sessionKey,
        sessionLocale: state.sessionLocale ?? action.sessionLocale,
      };
    case "feedback-started":
      return {
        ...state,
        sessionKey: action.sessionKey,
        sessionLocale: action.sessionLocale,
        responseKey: action.responseKey,
        feedbackStatus: "submitting",
      };
    case "session-ready":
      return { ...state, sessionId: action.sessionId };
    case "session-replaced":
      // The old session expired or is unknown: a new one, with its own keys.
      return {
        ...state,
        sessionId: null,
        sessionKey: action.sessionKey,
        sessionLocale: action.sessionLocale,
        responseKey: action.responseKey,
      };
    case "feedback-offline":
      return { ...state, feedbackStatus: "offline" };
    case "feedback-failed":
      return { ...state, feedbackStatus: "error" };
    case "feedback-succeeded":
      // `rating` is cleared here, not kept. Nothing after the rating is stored
      // may vary with its value, and the cheapest way to keep that true is for
      // the value not to exist on this side of the transition.
      return {
        ...state,
        screen: "handoff",
        rating: null,
        sessionId: action.sessionId,
        responseId: action.responseId,
        destinationKey: action.destinationKey,
        destinationPending: true,
        feedbackStatus: "idle",
      };
    case "destination-recorded":
      return { ...state, destinationPending: false };
  }
}
