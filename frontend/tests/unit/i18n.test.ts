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
    expect(customerMessages.es.noteTrust(business)).toContain(business);
    expect(customerMessages.ht.praiseSupport(business)).toContain(business);
  });
});

