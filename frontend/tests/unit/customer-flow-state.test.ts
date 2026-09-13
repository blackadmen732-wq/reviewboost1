import { describe, expect, it } from "vitest";

import {
  customerFlowReducer,
  initialCustomerFlowState,
} from "@/features/customer-flow/customer-flow-state";
import type { RatingValue } from "@/lib/i18n/customer-messages";

describe("customer flow state", () => {
  it("starts with no selected star", () => {
    expect(initialCustomerFlowState.rating).toBeNull();
    expect(initialCustomerFlowState.screen).toBe("rating");
  });

  it.each([1, 2, 3, 4, 5] satisfies RatingValue[])(
    "selects rating %s and stays on the rating screen",
    (rating) => {
      const state = customerFlowReducer(initialCustomerFlowState, {
        type: "select-rating",
        rating,
      });

      expect(state).toMatchObject({
        screen: "rating",
        rating,
      });
    },
  );

  it("resets status to idle on feedback-succeeded", () => {
    let state = customerFlowReducer(initialCustomerFlowState, {
      type: "select-rating",
      rating: 4,
    });
    state = customerFlowReducer(state, {
      type: "feedback-started",
      sessionKey: "session-key-123456",
      responseKey: "response-key-123456",
    });
    state = customerFlowReducer(state, {
      type: "feedback-succeeded",
    });

    expect(state.feedbackStatus).toBe("idle");
  });

  it("keeps a stable attempt key through recoverable errors", () => {
    const started = customerFlowReducer(initialCustomerFlowState, {
      type: "feedback-started",
      sessionKey: "session-key-123456",
      responseKey: "response-key-123456",
    });
    const failed = customerFlowReducer(started, { type: "feedback-failed" });
    const retried = customerFlowReducer(failed, {
      type: "feedback-started",
      sessionKey: failed.sessionKey as string,
      responseKey: failed.responseKey as string,
    });

    expect(retried.sessionKey).toBe("session-key-123456");
    expect(retried.responseKey).toBe("response-key-123456");
  });

  it("creates a fresh response attempt after the rating changes", () => {
    const started = customerFlowReducer(
      { ...initialCustomerFlowState, rating: 4 },
      {
        type: "feedback-started",
        sessionKey: "session-key-123456",
        responseKey: "response-key-123456",
      },
    );

    const ratingChanged = customerFlowReducer(started, {
      type: "select-rating",
      rating: 3,
    });
    expect(ratingChanged.responseKey).toBeNull();
    expect(ratingChanged.sessionKey).toBe("session-key-123456");
  });
});
