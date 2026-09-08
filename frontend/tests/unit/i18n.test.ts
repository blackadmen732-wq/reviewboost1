import { describe, expect, it } from "vitest";

import { customerMessages } from "@/lib/i18n/customer-messages";

describe("customer translations", () => {
  it("keeps English, Spanish, and Haitian Creole dictionary shapes identical", () => {
    const englishKeys = Object.keys(customerMessages.en).sort();
    expect(Object.keys(customerMessages.es).sort()).toEqual(englishKeys);
    expect(Object.keys(customerMessages.ht).sort()).toEqual(englishKeys);
  });

  it("preserves business names and Unicode in interpolated copy", () => {
    const business = "Café Zoë & Frères";
    expect(customerMessages.es.businessLogoAlt(business)).toContain(business);
    expect(customerMessages.ht.businessLogoAlt(business)).toContain(business);
  });

  it("carries no copy for the steps the fast path does not have", () => {
    // The dictionary is the cheapest place to catch a step creeping back: a note
    // prompt, a Continue button, a second question and a thank-you screen all
    // need words before they need components.
    const removed = [
      "noteLabel",
      "notePlaceholder",
      "noteTrust",
      "optional",
      "continue",
      "googlePrompt",
      "googleAction",
      "googleContinue",
      "praiseHeading",
      "praiseSupport",
      "firstNameLabel",
      "sendThanks",
      "skip",
      "thanksHeading",
      "doneHeading",
      "closePage",
      // Sentiment words under the stars. A rating is a number the business
      // reads, not a verdict the page announces back to the customer.
      "ratingLabels",
    ];
    const keys = Object.keys(customerMessages.en);
    for (const key of removed) expect(keys).not.toContain(key);
  });
});

