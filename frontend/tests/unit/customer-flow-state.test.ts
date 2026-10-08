import { describe, expect, it } from "vitest";

import {
  customerFlowReducer,
  initialCustomerFlowState,
  persistableState,
  type PendingRating,
} from "@/features/customer-flow/customer-flow-state";
import type { RatingValue } from "@/lib/i18n/customer-messages";

function pending(rating: RatingValue, key = "rb_rating_0000-key-123456"): PendingRating {
  return { key, rating, locale: "en" };
}

describe("customer flow state", () => {
  it("starts with no selected star and nothing waiting", () => {
    expect(initialCustomerFlowState.rating).toBeNull();
    expect(initialCustomerFlowState.pending).toBeNull();
    expect(initialCustomerFlowState.screen).toBe("rating");
  });

  it.each([1, 2, 3, 4, 5] satisfies RatingValue[])(
    "erases rating %s from the screen before the uniform handoff",
    (rating) => {
      let state = customerFlowReducer(initialCustomerFlowState, {
        type: "rating-leaving",
        pending: pending(rating),
      });
      state = customerFlowReducer(state, { type: "rating-sent" });

      expect(state).toMatchObject({ screen: "handoff", rating: null, feedbackStatus: "idle" });
      // The request is kept for a re-send until the server confirms it, but
      // nothing on the handoff reads it.
      expect(state.pending).toEqual(pending(rating));
    },
  );

  it("reaches the handoff in one transition from the tap — there is no middle screen", () => {
    const screens = new Set<string>();
    let state = initialCustomerFlowState;

    state = customerFlowReducer(state, { type: "rating-leaving", pending: pending(1) });
    screens.add(state.screen);
    state = customerFlowReducer(state, { type: "rating-sent" });
    screens.add(state.screen);
    state = customerFlowReducer(state, { type: "rating-settled", key: pending(1).key });
    screens.add(state.screen);

    expect([...screens]).toEqual(["rating", "handoff"]);
  });

  it("holds an offline tap on the rating screen, and a later tap replaces it", () => {
    const held = customerFlowReducer(initialCustomerFlowState, {
      type: "rating-held-offline",
      pending: pending(2, "rb_rating_first-key-123456"),
    });
    expect(held).toMatchObject({ screen: "rating", rating: 2, feedbackStatus: "offline" });

    const changed = customerFlowReducer(held, {
      type: "rating-held-offline",
      pending: pending(5, "rb_rating_second-key-12345"),
    });
    expect(changed.pending).toEqual(pending(5, "rb_rating_second-key-12345"));
  });

  it("drops the request only when the server settles that same request", () => {
    const sent = customerFlowReducer(
      customerFlowReducer(initialCustomerFlowState, { type: "rating-leaving", pending: pending(3) }),
      { type: "rating-sent" },
    );

    expect(customerFlowReducer(sent, { type: "rating-settled", key: "rb_rating_other-key-123456" })).toBe(sent);
    expect(customerFlowReducer(sent, { type: "rating-settled", key: pending(3).key })).toMatchObject({
      screen: "handoff",
      pending: null,
    });
  });

  it("keeps a page that is leaving as the handoff it is becoming", () => {
    const leaving = customerFlowReducer(initialCustomerFlowState, {
      type: "rating-leaving",
      pending: pending(4),
    });
    expect(leaving).toMatchObject({ screen: "rating", rating: 4 });

    // What a customer who comes back finds: never a form to rate twice.
    expect(persistableState(leaving)).toMatchObject({
      screen: "handoff",
      rating: null,
      pending: pending(4),
    });
    expect(persistableState(initialCustomerFlowState)).toBe(initialCustomerFlowState);
  });
});
