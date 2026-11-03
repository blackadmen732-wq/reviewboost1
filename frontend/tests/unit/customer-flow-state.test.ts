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
    "erases rating %s before the uniform handoff",
    (rating) => {
      let state = customerFlowReducer(initialCustomerFlowState, {
        type: "select-rating",
        rating,
      });
      state = customerFlowReducer(state, {
        type: "feedback-started",
        sessionKey: "session-key-123456",
        sessionLocale: "en",
        responseKey: "response-key-123456",
      });
      state = customerFlowReducer(state, {
        type: "feedback-succeeded",
        sessionId: "session-1",
        responseId: "response-1",
        destinationKey: "destination-key-123456",
      });

      expect(state).toMatchObject({
        screen: "handoff",
        rating: null,
        sessionId: "session-1",
        responseId: "response-1",
        destinationPending: true,
      });
    },
  );

  it("reaches the handoff in one transition from the tap — there is no middle screen", () => {
    const screens = new Set<string>();
    let state = initialCustomerFlowState;

    state = customerFlowReducer(state, { type: "select-rating", rating: 1 });
    screens.add(state.screen);
    state = customerFlowReducer(state, {
      type: "feedback-started",
      sessionKey: "session-key-123456",
      sessionLocale: "en",
      responseKey: "response-key-123456",
    });
    screens.add(state.screen);
    state = customerFlowReducer(state, {
      type: "feedback-succeeded",
      sessionId: "session-1",
      responseId: "response-1",
      destinationKey: "destination-key-123456",
    });
    screens.add(state.screen);

    expect([...screens]).toEqual(["rating", "handoff"]);
  });

  it("keeps a stable attempt key through recoverable errors", () => {
    const started = customerFlowReducer(initialCustomerFlowState, {
      type: "feedback-started",
      sessionKey: "session-key-123456",
      sessionLocale: "en",
      responseKey: "response-key-123456",
    });
    const failed = customerFlowReducer(started, { type: "feedback-failed" });
    const retried = customerFlowReducer(failed, {
      type: "feedback-started",
      sessionKey: failed.sessionKey as string,
      sessionLocale: "en",
      responseKey: failed.responseKey as string,
    });

    expect(retried.sessionKey).toBe("session-key-123456");
    expect(retried.responseKey).toBe("response-key-123456");
  });

  it("keeps the session the page opened with, key and language, whatever happens next", () => {
    let state = customerFlowReducer(initialCustomerFlowState, {
      type: "session-opening",
      sessionKey: "session-key-opened",
      sessionLocale: "es",
    });
    // A second opening (a reload, a tab shown again) is the same session.
    state = customerFlowReducer(state, {
      type: "session-opening",
      sessionKey: "session-key-other",
      sessionLocale: "en",
    });
    state = customerFlowReducer(state, { type: "change-locale", locale: "ht" });

    expect(state.sessionKey).toBe("session-key-opened");
    expect(state.sessionLocale).toBe("es");
    expect(state.locale).toBe("ht");
  });

  it("creates a fresh response attempt after the rating changes", () => {
    const started = customerFlowReducer(
      { ...initialCustomerFlowState, rating: 4 },
      {
        type: "feedback-started",
        sessionKey: "session-key-123456",
        sessionLocale: "en",
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

  it("settles the destination record without disturbing the saved rating", () => {
    const handed = customerFlowReducer(
      {
        ...initialCustomerFlowState,
        screen: "handoff",
        sessionId: "session-1",
        responseId: "response-1",
        destinationKey: "destination-key-123456",
        destinationPending: true,
      },
      { type: "destination-recorded" },
    );

    expect(handed).toMatchObject({
      screen: "handoff",
      destinationPending: false,
      sessionId: "session-1",
      responseId: "response-1",
    });
  });
});
