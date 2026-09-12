import { describe, expect, it } from "vitest";

import { initialCustomerPageState } from "@/features/customer-page/customer-page-state";
import {
  clearCustomerDraft,
  loadCustomerDraft,
  saveCustomerDraft,
} from "@/features/customer-page/recovery-storage";

describe("same-tab customer recovery", () => {
  it("retains the rating and its idempotency keys, scoped to one token", () => {
    const draft = {
      ...initialCustomerPageState,
      rating: 3 as const,
      phase: "failed" as const,
      sessionKey: "session-key-123456",
      responseKey: "response-key-123456",
      locale: "ht" as const,
    };

    saveCustomerDraft("fixture-valid", draft);

    expect(loadCustomerDraft("fixture-valid")).toEqual(draft);
    expect(loadCustomerDraft("another-token")).toBeNull();
  });

  it("turns a save that was interrupted mid-flight into a retryable failure", () => {
    saveCustomerDraft("fixture-valid", {
      ...initialCustomerPageState,
      rating: 4,
      phase: "saving",
      responseKey: "response-key-abcdef",
    });

    const recovered = loadCustomerDraft("fixture-valid");
    expect(recovered?.phase).toBe("failed");
    // The star the customer tapped survives, and so does the key, so the retry
    // cannot produce a second rating for the same tap.
    expect(recovered?.rating).toBe(4);
    expect(recovered?.responseKey).toBe("response-key-abcdef");
  });

  it("keeps a completed rating so returning from Google does not offer a second one", () => {
    saveCustomerDraft("fixture-valid", {
      ...initialCustomerPageState,
      rating: 5,
      phase: "saved",
      sessionId: "session_1",
      responseId: "response_1",
    });

    expect(loadCustomerDraft("fixture-valid")?.phase).toBe("saved");
  });

  it("rejects corrupt storage rather than rendering from it", () => {
    window.sessionStorage.setItem("reviewboost:customer-page:fixture-valid", "{broken");
    expect(loadCustomerDraft("fixture-valid")).toBeNull();
  });

  it("ignores a draft written by an older version of the page", () => {
    window.sessionStorage.setItem(
      "reviewboost:customer-page:fixture-valid",
      JSON.stringify({ version: 1, rating: 4, phase: "idle" }),
    );
    expect(loadCustomerDraft("fixture-valid")).toBeNull();
  });

  it("can explicitly remove a draft", () => {
    saveCustomerDraft("fixture-valid", { ...initialCustomerPageState, rating: 2 });
    clearCustomerDraft("fixture-valid");
    expect(loadCustomerDraft("fixture-valid")).toBeNull();
  });
});
