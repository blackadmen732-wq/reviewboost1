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
    "erases rating %s and the note before the uniform Google screen",
    (rating) => {
      let state = customerFlowReducer(initialCustomerFlowState, {
        type: "select-rating",
        rating,
      });
      state = customerFlowReducer(state, {
        type: "change-note",
        note: "Private note",
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
        note: "",
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

  it("creates a fresh response attempt after the rating or note changes", () => {
    const started = customerFlowReducer(
      { ...initialCustomerFlowState, rating: 4, note: "Good service" },
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

    const noteChanged = customerFlowReducer(started, {
      type: "change-note",
      note: "The service was good, but slow.",
    });
    expect(noteChanged.responseKey).toBeNull();
    expect(noteChanged.sessionKey).toBe("session-key-123456");
  });

  it("creates a fresh Team Praise attempt after its draft changes", () => {
    const started = customerFlowReducer(
      {
        ...initialCustomerFlowState,
        praiseFirstName: "Sarah",
        praiseNote: "Very kind",
      },
      { type: "praise-started", idempotencyKey: "praise-key-123456" },
    );
    const edited = customerFlowReducer(started, {
      type: "change-praise",
      firstName: "Sarah",
      note: "Very kind and helpful",
    });

    expect(edited.praiseKey).toBeNull();
  });

  it("clears all private drafts on finish", () => {
    const completed = customerFlowReducer(
      {
        ...initialCustomerFlowState,
        screen: "praise",
        praiseFirstName: "Zoë",
        praiseNote: "Très attentionnée",
        sessionId: "session-1",
        responseId: "response-1",
      },
      { type: "finish" },
    );

    expect(completed).toMatchObject({
      screen: "finished",
      rating: null,
      note: "",
      praiseFirstName: "",
      praiseNote: "",
      sessionId: null,
      responseId: null,
    });
  });
});
