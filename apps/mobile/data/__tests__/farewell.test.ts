import { describe, expect, it } from "vitest";

import { DELETED_BUSINESS_AND_SIGN_IN, sayAfterDeletion, takeDeletionNotice } from "../farewell";

describe("the line after a deletion", () => {
  it("is said once, on the next screen, then gone", () => {
    expect(takeDeletionNotice()).toBeNull();
    sayAfterDeletion(DELETED_BUSINESS_AND_SIGN_IN);
    expect(takeDeletionNotice()).toBe("Your business and sign-in were deleted.");
    expect(takeDeletionNotice()).toBeNull();
  });
});
