import { describe, expect, it } from "vitest";

import { shouldUseCustomerFixtures } from "@/lib/api/fixture-flags";
import { createIdempotencyKey } from "@/lib/api/idempotency";

describe("customer mutation safety", () => {
  it("creates unique operation-scoped idempotency keys", () => {
    const first = createIdempotencyKey("response");
    const second = createIdempotencyKey("response");
    expect(first).toMatch(/^rb_response_[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
  });

  it("requires an explicit non-production fixture flag", () => {
    expect(shouldUseCustomerFixtures({ nodeEnv: "development", fixtureFlag: "true" })).toBe(true);
    expect(shouldUseCustomerFixtures({ nodeEnv: "development", fixtureFlag: "false" })).toBe(false);
    expect(() =>
      shouldUseCustomerFixtures({ nodeEnv: "production", fixtureFlag: "true" }),
    ).toThrow(/forbidden in production/i);
  });
});

