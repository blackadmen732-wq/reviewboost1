import { describe, expect, it } from "vitest";

import { currentStep, deriveSetupSteps, type SetupInput } from "@/features/setup/setup-model";

const tag = (over: Partial<{ standId: string; status: string; nfcProvisionedAt: string | null }> = {}) => ({
  standId: "s1",
  label: "Counter",
  status: "active",
  nfcProvisionedAt: null,
  tokenRotatedAt: null,
  ...over,
});

const base: SetupInput = {
  hasGoogleLink: false,
  hasCustomerPhoto: false,
  hasLocation: true,
  stands: [],
  hasAnyRating: false,
  canManage: true,
};

describe("setup steps", () => {
  it("starts at step 1 with the Google link when it is missing", () => {
    const steps = deriveSetupSteps(base);
    expect(currentStep(steps)).toBe("page");
    expect(steps[0]!.action).toEqual({ label: "Add your Google review link", href: "/settings" });
  });

  it("sends a business with no details back to onboarding", () => {
    const steps = deriveSetupSteps({ ...base, hasLocation: false });
    expect(steps[0]!.action?.href).toBe("/onboarding");
  });

  it("moves to the Tag once the page works, and offers the editor for the photo", () => {
    const steps = deriveSetupSteps({ ...base, hasGoogleLink: true, stands: [tag()] });
    expect(currentStep(steps)).toBe("tag");
    expect(steps[0]!.done).toBe(true);
    expect(steps[0]!.action?.href).toBe("/customer-page");
    expect(steps[0]!.body).toMatch(/photo/);
    expect(steps[1]!.action).toEqual({ label: "Set up your Tag", href: "/stands/s1" });
  });

  it("has no Tag link before a Tag exists, so the page shows Create a Tag", () => {
    const steps = deriveSetupSteps({ ...base, hasGoogleLink: true });
    expect(steps[1]!.action).toBeNull();
  });

  it("counts only a programmed active Tag as done", () => {
    const paused = deriveSetupSteps({ ...base, hasGoogleLink: true, stands: [tag({ status: "inactive", nfcProvisionedAt: "2026-10-01" })] });
    expect(paused[1]!.done).toBe(false);
    const live = deriveSetupSteps({ ...base, hasGoogleLink: true, stands: [tag({ nfcProvisionedAt: "2026-10-01" })] });
    expect(live[1]!.done).toBe(true);
    expect(currentStep(live)).toBe("test");
  });

  it("is all done after the first rating", () => {
    const steps = deriveSetupSteps({ ...base, hasGoogleLink: true, hasCustomerPhoto: true, stands: [tag({ nfcProvisionedAt: "2026-10-01" })], hasAnyRating: true });
    expect(currentStep(steps)).toBeNull();
    expect(steps[2]!.action?.href).toBe("/feedback");
  });

  it("gives a member no buttons that would be refused", () => {
    const steps = deriveSetupSteps({ ...base, canManage: false, hasGoogleLink: true, stands: [tag()] });
    expect(steps[0]!.action).toBeNull();
    expect(steps[1]!.action).toBeNull();
  });

  it("explains every step in plain words", () => {
    for (const step of deriveSetupSteps(base)) {
      expect(step.howTo.length).toBeGreaterThan(1);
      expect(step.body).not.toMatch(/NFC record|token|URL|API/i);
    }
  });
});
