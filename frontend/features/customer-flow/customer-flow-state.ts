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
  | { type: "feedback-started"; sessionKey: string; responseKey: string }
  | { type: "session-ready"; sessionId: string }
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
    case "feedback-started":
      return {
        ...state,
        sessionKey: action.sessionKey,
        responseKey: action.responseKey,
        feedbackStatus: "submitting",
      };
    case "session-ready":
      return { ...state, sessionId: action.sessionId };
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
