import { describe, expect, it } from "vitest";

import {
  DEFAULT_TEXT_REQUEST_TEMPLATE,
  DEFAULT_TEXT_REQUEST_WORDS,
  previewParts,
  templateFromOwnerWords,
} from "@/lib/sms/text-request-message";

/**
 * Owners write words; the link goes at the end. They never see or type the
 * server's {{link}} placeholder, and the preview shows the same words the
 * server will send.
 */
describe("a Text Request's words", () => {
  it("uses the server default when the owner writes nothing", () => {
    expect(templateFromOwnerWords("   ")).toBeUndefined();
    expect(previewParts("")).toEqual({ before: DEFAULT_TEXT_REQUEST_WORDS, after: "" });
    expect(DEFAULT_TEXT_REQUEST_TEMPLATE).toContain("{{link}}");
    expect(DEFAULT_TEXT_REQUEST_WORDS).not.toContain("{{link}}");
  });

  it("puts the link after the owner's own words", () => {
    expect(templateFromOwnerWords("Thanks for coming in!")).toBe("Thanks for coming in! {{link}}");
    expect(previewParts("Thanks for coming in!")).toEqual({
      before: "Thanks for coming in!",
      after: "",
    });
  });

  it("keeps a link the owner placed mid-message where they put it", () => {
    expect(templateFromOwnerWords("Tap {{link}} please")).toBe("Tap {{link}} please");
    expect(previewParts("Tap {{link}} please")).toEqual({ before: "Tap", after: "please" });
  });
});
