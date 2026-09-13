import type { Locale } from "@/lib/i18n/config";
import type { RatingValue } from "@/lib/i18n/customer-messages";

export type CustomerScreen = "rating";
export type SubmissionStatus = "idle" | "submitting" | "error" | "offline";

export interface CustomerFlowState {
  screen: CustomerScreen;
  rating: RatingValue | null;
  sessionId: string | null;
  sessionKey: string | null;
  responseKey: string | null;
  feedbackStatus: SubmissionStatus;
  locale: Locale;
}

export const initialCustomerFlowState: CustomerFlowState = {
  screen: "rating",
  rating: null,
  sessionId: null,
  sessionKey: null,
  responseKey: null,
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
  | { type: "feedback-succeeded" };

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
      return { ...state, feedbackStatus: "idle" };
  }
}
