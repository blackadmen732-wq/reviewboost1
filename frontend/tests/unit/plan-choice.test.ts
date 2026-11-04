import { describe, expect, it } from "vitest";
import {
  billingForPlan,
  parsePlanChoice,
  startForPlan,
} from "@/lib/owner/plan-choice";
import { safeInternalPath } from "@/lib/security/safe-redirect";

describe("plan choice across activation", () => {
  it.each(["starter", "growth", "pro"] as const)(
    "preserves %s through the existing safe login return path",
    (plan) => {
      const start = new URL(startForPlan(plan), "https://reviewboost.fit");
      const next = safeInternalPath(
        start.searchParams.get("next"),
        "https://reviewboost.fit",
      );
      expect(next).toBe(`/onboarding?plan=${plan}`);
      expect(
        parsePlanChoice(
          new URL(next, "https://reviewboost.fit").searchParams.get("plan"),
        ),
      ).toBe(plan);
      expect(billingForPlan(plan)).toBe(`/settings/billing?plan=${plan}`);
    },
  );
  it.each([
    undefined,
    null,
    "constructor",
    "__proto__",
    "//evil.test",
    ["pro"],
    "enterprise",
  ])("does not treat unrecognised input as a plan", (value) => {
    expect(parsePlanChoice(value)).toBeNull();
  });
});
