import type { Locale } from "@/lib/i18n/config";
import type { RatingValue } from "@/lib/i18n/customer-messages";

export type CustomerScreen = "rating" | "google" | "praise" | "finished";
export type SubmissionStatus = "idle" | "submitting" | "error" | "offline";

export interface CustomerFlowState {
  screen: CustomerScreen;
  rating: RatingValue | null;
  note: string;
  sessionId: string | null;
  responseId: string | null;
  sessionKey: string | null;
  responseKey: string | null;
  googleClickKey: string | null;
  googleClickPending: boolean;
  praiseKey: string | null;
  praiseFirstName: string;
  praiseNote: string;
  feedbackStatus: SubmissionStatus;
  praiseStatus: SubmissionStatus;
  locale: Locale;
}

export const initialCustomerFlowState: CustomerFlowState = {
  screen: "rating",
  rating: null,
  note: "",
  sessionId: null,
  responseId: null,
  sessionKey: null,
  responseKey: null,
  googleClickKey: null,
  googleClickPending: false,
  praiseKey: null,
  praiseFirstName: "",
  praiseNote: "",
  feedbackStatus: "idle",
  praiseStatus: "idle",
  locale: "en",
};

export type CustomerFlowAction =
  | { type: "restore"; state: CustomerFlowState }
  | { type: "select-rating"; rating: RatingValue }
  | { type: "change-note"; note: string }
  | { type: "change-locale"; locale: Locale }
  | { type: "feedback-started"; sessionKey: string; responseKey: string }
  | { type: "session-ready"; sessionId: string }
  | { type: "feedback-offline" }
  | { type: "feedback-failed" }
  | { type: "feedback-succeeded"; sessionId: string; responseId: string }
  | { type: "google-click-started"; idempotencyKey: string }
  | { type: "google-click-recorded" }
  | { type: "show-praise" }
  | { type: "change-praise"; firstName: string; note: string }
  | { type: "praise-started"; idempotencyKey: string }
  | { type: "praise-offline" }
  | { type: "praise-failed" }
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
        feedbackStatus: "idle",
      };
    case "change-note":
      return { ...state, note: action.note, feedbackStatus: "idle" };
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
        note: "",
        sessionId: action.sessionId,
        responseId: action.responseId,
        feedbackStatus: "idle",
      };
    case "google-click-started":
      return {
        ...state,
        screen: "praise",
        googleClickKey: action.idempotencyKey,
        googleClickPending: true,
      };
    case "google-click-recorded":
      return { ...state, googleClickPending: false };
    case "show-praise":
      return { ...state, screen: "praise" };
    case "change-praise":
      return {
        ...state,
        praiseFirstName: action.firstName,
        praiseNote: action.note,
        praiseStatus: "idle",
      };
    case "praise-started":
      return {
        ...state,
        praiseKey: action.idempotencyKey,
        praiseStatus: "submitting",
      };
    case "praise-offline":
      return { ...state, praiseStatus: "offline" };
    case "praise-failed":
      return { ...state, praiseStatus: "error" };
    case "finish":
      return {
        ...initialCustomerFlowState,
        screen: "finished",
        locale: state.locale,
      };
  }
}

