import { describe, expect, it } from "vitest";

import { customerPagePreviewUrl } from "../../lib/preview-url";
import { isReviewBoostTagUrl } from "../../lib/tag-url";

const TAG = "https://reviewboost.fit/q/AbCdEfGh12345678";

describe("the owner's preview of a customer page", () => {
  it("opens the Tag link with preview=1, so nothing is recorded", () => {
    expect(customerPagePreviewUrl(TAG)).toBe(`${TAG}?preview=1`);
  });

  it("keeps a query that is already there, and never adds the flag twice", () => {
    expect(customerPagePreviewUrl(`${TAG}?lang=es`)).toBe(`${TAG}?lang=es&preview=1`);
    expect(customerPagePreviewUrl(`${TAG}?preview=0&lang=es`)).toBe(`${TAG}?lang=es&preview=1`);
    expect(customerPagePreviewUrl(`${TAG}?preview=1`)).toBe(`${TAG}?preview=1`);
    expect(customerPagePreviewUrl(`${TAG}#top`)).toBe(`${TAG}?preview=1#top`);
  });

  it("is never a link a Tag may carry: the code and the chip stay the plain one", () => {
    expect(isReviewBoostTagUrl(TAG)).toBe(true);
    expect(isReviewBoostTagUrl(customerPagePreviewUrl(TAG))).toBe(false);
  });
});
