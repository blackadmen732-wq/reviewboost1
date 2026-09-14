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
    "erases rating %s before the uniform Google screen",
    (rating) => {
      let state = customerFlowReducer(initialCustomerFlowState, {
        type: "select-rating",
        rating,
      });
      state = customerFlowReducer(state, {
        type: "feedback-started",
        sessionKey: "session-key-123456",
        responseKey: "response-key-123456",
      });
      state = customerFlowReducer(state, {
        type: "feedback-succeeded",
        sessionId: "session-1",
        responseId: "response-1",
      });

      expect(state).toMatchObject({
        screen: "google",
        rating: null,
        sessionId: "session-1",
        responseId: "response-1",
      });
    },
  );

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

    // A new response key, because this is a different answer. Reusing the key
    // would make the server treat the corrected rating as a replay of the
    // first one and store the number the customer changed their mind about.
    expect(ratingChanged.responseKey).toBeNull();
    expect(ratingChanged.sessionKey).toBe("session-key-123456");
  });

  it("goes to the finished screen when the customer leaves for Google", () => {
    const state = customerFlowReducer(
      {
        ...initialCustomerFlowState,
        screen: "google",
        sessionId: "session-1",
        responseId: "response-1",
      },
      { type: "google-click-started", idempotencyKey: "google-key-123456" },
    );

    // V1 has no praise step, so Google is the last thing the flow offers.
    expect(state.screen).toBe("finished");

    // The click may not have reached the server yet. The key and the ids have
    // to survive so the reconnect retry can still send it -- this is why the
    // transition is not `finish`, which resets them.
    expect(state.googleClickPending).toBe(true);
    expect(state.googleClickKey).toBe("google-key-123456");
    expect(state.sessionId).toBe("session-1");
  });

  it("clears the private draft on finish", () => {
    const completed = customerFlowReducer(
      {
        ...initialCustomerFlowState,
        screen: "google",
        rating: 5,
        sessionId: "session-1",
        responseId: "response-1",
      },
      { type: "finish" },
    );

    expect(completed).toMatchObject({
      screen: "finished",
      rating: null,
      sessionId: null,
      responseId: null,
    });
  });

  it("has no screen that collects free text", () => {
    // The V1 public contract accepts a rating and nothing else. A screen that
    // asked for more would be collecting something the API rejects.
    const screens = new Set<string>();
    screens.add(initialCustomerFlowState.screen);
    screens.add(
      customerFlowReducer(initialCustomerFlowState, {
        type: "feedback-succeeded",
        sessionId: "s",
        responseId: "r",
      }).screen,
    );
    screens.add(customerFlowReducer(initialCustomerFlowState, { type: "finish" }).screen);
    expect([...screens].sort()).toEqual(["finished", "google", "rating"]);
  });
});
