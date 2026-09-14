import type { Locale } from "@/lib/i18n/config";
import type { RatingValue } from "@/lib/i18n/customer-messages";

/**
 * The V1 customer flow, and all of it: rate, then Google.
 *
 * There is no note step and no praise step. Both were removed from the public
 * contract (see openapi/reviewboost-public-v1.yaml), and a screen that collects
 * something the API will not accept is worse than no screen -- the customer
 * believes they wrote to the owner and nothing is stored.
 */
export type CustomerScreen = "rating" | "google" | "finished";
export type SubmissionStatus = "idle" | "submitting" | "error" | "offline";

export interface CustomerFlowState {
  screen: CustomerScreen;
  rating: RatingValue | null;
  sessionId: string | null;
  responseId: string | null;
  sessionKey: string | null;
  responseKey: string | null;
  googleClickKey: string | null;
  googleClickPending: boolean;
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
  googleClickKey: null,
  googleClickPending: false,
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
  | { type: "feedback-succeeded"; sessionId: string; responseId: string }
  | { type: "google-click-started"; idempotencyKey: string }
  | { type: "google-click-recorded" }
  | { type: "finish" };

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
      return {
        ...state,
        screen: "google",
        rating: null,
        sessionId: action.sessionId,
        responseId: action.responseId,
        feedbackStatus: "idle",
      };
    case "google-click-started":
      // The customer is on their way to Google. `finished` is what they come
      // back to. Deliberately not `finish`, which resets the state: the click
      // may still be unsent, and the key has to survive for the reconnect
      // retry in customer-flow.tsx.
      return {
        ...state,
        screen: "finished",
        googleClickKey: action.idempotencyKey,
        googleClickPending: true,
      };
    case "google-click-recorded":
      return { ...state, googleClickPending: false };
    case "finish":
      return {
        ...initialCustomerFlowState,
        screen: "finished",
        locale: state.locale,
      };
  }
}
