import type { Locale } from "@/lib/i18n/config";
import type { RatingValue } from "@/lib/i18n/customer-messages";

/**
 * V1 customer contract: one tap.
 *
 * `rating` is the only screen a customer is ever asked to act on. Tapping a
 * star opens the business's public review destination in that same moment and
 * sends the rating alongside it. `handoff` is not a step — it is what the page
 * shows while the browser is already on its way, and what a customer returning
 * with the back button lands on instead of a form they could rate twice.
 */
export type CustomerScreen = "rating" | "handoff";
export type SubmissionStatus = "idle" | "leaving" | "offline";

/**
 * A tap the server has not yet confirmed: the frozen request, so a re-send is
 * byte-for-byte the first one under the same key. It is the only place the
 * value lives after the tap, and only until the save is confirmed; nothing on
 * screen reads it.
 */
export interface PendingRating {
  key: string;
  rating: RatingValue;
  locale: Locale;
}

export interface CustomerFlowState {
  screen: CustomerScreen;
  /** The star shown filled on the rating screen. Always null on the handoff. */
  rating: RatingValue | null;
  pending: PendingRating | null;
  feedbackStatus: SubmissionStatus;
  locale: Locale;
}

export const initialCustomerFlowState: CustomerFlowState = {
  screen: "rating",
  rating: null,
  pending: null,
  feedbackStatus: "idle",
  locale: "en",
};

export type CustomerFlowAction =
  | { type: "restore"; state: CustomerFlowState }
  | { type: "change-locale"; locale: Locale }
  /** Online tap: the page is already leaving; the stars show the tap. */
  | { type: "rating-leaving"; pending: PendingRating }
  /** Offline tap: held on the rating screen until the connection returns. */
  | { type: "rating-held-offline"; pending: PendingRating }
  /** The handoff screen, for a page still visible while the destination loads. */
  | { type: "rating-sent" }
  /** The server has the rating (or refused it for good): nothing to re-send. */
  | { type: "rating-settled"; key: string };

export function customerFlowReducer(
  state: CustomerFlowState,
  action: CustomerFlowAction,
): CustomerFlowState {
  switch (action.type) {
    case "restore":
      return action.state;
    case "change-locale":
      return { ...state, locale: action.locale };
    case "rating-leaving":
      return {
        ...state,
        rating: action.pending.rating,
        pending: action.pending,
        feedbackStatus: "leaving",
      };
    case "rating-held-offline":
      return {
        ...state,
        rating: action.pending.rating,
        pending: action.pending,
        feedbackStatus: "offline",
      };
    case "rating-sent":
      // `rating` is cleared here, not kept. Nothing after the tap may vary
      // with its value, and the cheapest way to keep that true is for the
      // value not to exist on screen on this side of the transition.
      return {
        ...state,
        screen: "handoff",
        rating: null,
        feedbackStatus: "idle",
      };
    case "rating-settled":
      return state.pending?.key === action.key ? { ...state, pending: null } : state;
  }
}

/**
 * The state as it must be kept for a customer who comes back.
 *
 * A page that is leaving is, for anyone who returns to it, already on the
 * handoff: storing the brief "stars filling" moment instead would bring a
 * customer back from Google to a form they could rate twice.
 */
export function persistableState(state: CustomerFlowState): CustomerFlowState {
  return state.feedbackStatus === "leaving"
    ? customerFlowReducer(state, { type: "rating-sent" })
    : state;
}
