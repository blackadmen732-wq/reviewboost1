import { describe, expect, it } from "vitest";

import {
  clearCustomerDraft,
  loadCustomerDraft,
  saveCustomerDraft,
} from "@/features/customer-flow/recovery-storage";
import { initialCustomerFlowState } from "@/features/customer-flow/customer-flow-state";

describe("same-tab customer recovery", () => {
  it("retains the draft and stable idempotency keys only for its token", () => {
    const draft = {
      ...initialCustomerFlowState,
      rating: 3 as const,
      sessionKey: "session-key-123456",
      responseKey: "response-key-123456",
      feedbackStatus: "error" as const,
      locale: "ht" as const,
    };

    saveCustomerDraft("fixture-valid", draft);

    expect(loadCustomerDraft("fixture-valid")).toEqual(draft);
    expect(loadCustomerDraft("another-token")).toBeNull();
  });

  it("converts interrupted submitting state into a recoverable error", () => {
    saveCustomerDraft("fixture-valid", {
      ...initialCustomerFlowState,
      rating: 4,
      feedbackStatus: "submitting",
    });

    expect(loadCustomerDraft("fixture-valid")?.feedbackStatus).toBe("error");
  });

  it("rejects corrupt storage", () => {
    window.sessionStorage.setItem("reviewboost:customer-flow:fixture-valid", "{broken");
    expect(loadCustomerDraft("fixture-valid")).toBeNull();
  });

  it("rejects a handoff draft that carries no saved response", () => {
    window.sessionStorage.setItem(
      "reviewboost:customer-flow:fixture-valid",
      JSON.stringify({ version: 2, ...initialCustomerFlowState, screen: "handoff" }),
    );
    expect(loadCustomerDraft("fixture-valid")).toBeNull();
  });

  it("keeps the handoff state so the back button cannot produce a second rating", () => {
    const handed = {
      ...initialCustomerFlowState,
      screen: "handoff" as const,
      sessionId: "session-1",
      responseId: "response-1",
      destinationKey: "destination-key-123456",
      destinationPending: false,
    };
    saveCustomerDraft("fixture-valid", handed);
    expect(loadCustomerDraft("fixture-valid")).toEqual(handed);
  });

  it("can explicitly remove a private draft", () => {
    saveCustomerDraft("fixture-valid", { ...initialCustomerFlowState, rating: 3 });
    clearCustomerDraft("fixture-valid");
    expect(loadCustomerDraft("fixture-valid")).toBeNull();
  });
});

