import { describe, expect, it } from "vitest";

import {
  clearCustomerDraft,
  loadCustomerDraft,
  saveCustomerDraft,
} from "@/features/customer-flow/recovery-storage";
import {
  initialCustomerFlowState,
  type CustomerFlowState,
} from "@/features/customer-flow/customer-flow-state";

const PENDING = { key: "rb_rating_1234-5678-key-abcdef", rating: 3 as const, locale: "ht" as const };

describe("same-tab customer recovery", () => {
  it("retains a held tap and its stable idempotency key only for its token", () => {
    const draft: CustomerFlowState = {
      ...initialCustomerFlowState,
      rating: 3,
      pending: PENDING,
      feedbackStatus: "offline",
      locale: "ht",
    };

    saveCustomerDraft("fixture-valid", draft);

    expect(loadCustomerDraft("fixture-valid")).toEqual(draft);
    expect(loadCustomerDraft("another-token")).toBeNull();
  });

  it("stores a page caught leaving as the handoff, so the back button finds no form", () => {
    saveCustomerDraft("fixture-valid", {
      ...initialCustomerFlowState,
      rating: 3,
      pending: PENDING,
      feedbackStatus: "leaving",
    });

    expect(loadCustomerDraft("fixture-valid")).toEqual({
      ...initialCustomerFlowState,
      screen: "handoff",
      rating: null,
      pending: PENDING,
      feedbackStatus: "idle",
    });
  });

  it("keeps the handoff state so the back button cannot produce a second rating", () => {
    const handed: CustomerFlowState = {
      ...initialCustomerFlowState,
      screen: "handoff",
      pending: null,
    };
    saveCustomerDraft("fixture-valid", handed);
    expect(loadCustomerDraft("fixture-valid")).toEqual(handed);
  });

  it("rejects corrupt storage", () => {
    window.sessionStorage.setItem("reviewboost:customer-flow:fixture-valid", "{broken");
    expect(loadCustomerDraft("fixture-valid")).toBeNull();
  });

  it("rejects a draft from the step-by-step flow, and a malformed pending request", () => {
    window.sessionStorage.setItem(
      "reviewboost:customer-flow:fixture-valid",
      JSON.stringify({ version: 2, ...initialCustomerFlowState, screen: "handoff" }),
    );
    expect(loadCustomerDraft("fixture-valid")).toBeNull();

    window.sessionStorage.setItem(
      "reviewboost:customer-flow:fixture-valid",
      JSON.stringify({
        version: 3,
        ...initialCustomerFlowState,
        screen: "handoff",
        pending: { key: "short", rating: 9, locale: "fr" },
      }),
    );
    expect(loadCustomerDraft("fixture-valid")).toBeNull();
  });

  it("rejects an offline hold with nothing held", () => {
    window.sessionStorage.setItem(
      "reviewboost:customer-flow:fixture-valid",
      JSON.stringify({ version: 3, ...initialCustomerFlowState, feedbackStatus: "offline" }),
    );
    expect(loadCustomerDraft("fixture-valid")).toBeNull();
  });

  it("can explicitly remove a private draft", () => {
    saveCustomerDraft("fixture-valid", { ...initialCustomerFlowState, rating: 3 });
    clearCustomerDraft("fixture-valid");
    expect(loadCustomerDraft("fixture-valid")).toBeNull();
  });
});
