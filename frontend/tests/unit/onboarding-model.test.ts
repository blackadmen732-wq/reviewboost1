import { describe, expect, it } from "vitest";

import {
  advanceOnboarding,
  canEnterOnboardingStep,
  nextOnboardingStep,
  ONBOARDING_STEPS,
  onboardingRequiresStand,
  onboardingStepNumber,
  prevOnboardingStep,
} from "@/features/onboarding/onboarding-model";

const created = { standId: "stand-1", standUrl: "https://app.reviewboost.test/q/token" };

describe("onboarding path", () => {
  it("is Business → Google → Preview → Tag → Print → Ready", () => {
    expect(ONBOARDING_STEPS).toEqual([
      "business",
      "google",
      "preview",
      "tag",
      "print",
      "ready",
    ]);
  });

  it("numbers steps from one", () => {
    expect(onboardingStepNumber("business")).toBe(1);
    expect(onboardingStepNumber("ready")).toBe(6);
  });

  it("walks forward and back without skipping preview", () => {
    expect(nextOnboardingStep("business")).toBe("google");
    expect(nextOnboardingStep("google")).toBe("preview");
    expect(nextOnboardingStep("ready")).toBeNull();
    expect(prevOnboardingStep("business")).toBeNull();
    expect(prevOnboardingStep("preview")).toBe("google");
  });

  it("blocks preview and later until a stand exists", () => {
    expect(onboardingRequiresStand("google")).toBe(false);
    expect(canEnterOnboardingStep("preview", null)).toBe(false);
    expect(canEnterOnboardingStep("print", null)).toBe(false);
    expect(advanceOnboarding("google", null)).toBeNull();
    expect(advanceOnboarding("google", created)).toBe("preview");
    expect(canEnterOnboardingStep("ready", created)).toBe(true);
  });
});
