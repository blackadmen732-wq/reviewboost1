/**
 * Activation path. Business → Google → Preview (frozen V2) → Tag → Print → Ready.
 *
 * Preview and later steps need a created stand. The API runs once, on Google
 * continue or skip — never again if they walk back.
 */

export const ONBOARDING_STEPS = [
  "business",
  "google",
  "preview",
  "tag",
  "print",
  "ready",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface CreatedStand {
  standUrl: string;
  standId: string;
}

export const ONBOARDING_STEP_COUNT = ONBOARDING_STEPS.length;

export function onboardingStepNumber(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step) + 1;
}

export function nextOnboardingStep(step: OnboardingStep): OnboardingStep | null {
  const index = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[index + 1] ?? null;
}

export function prevOnboardingStep(step: OnboardingStep): OnboardingStep | null {
  const index = ONBOARDING_STEPS.indexOf(step);
  return index > 0 ? (ONBOARDING_STEPS[index - 1] ?? null) : null;
}

export function onboardingRequiresStand(step: OnboardingStep): boolean {
  return step === "preview" || step === "tag" || step === "print" || step === "ready";
}

export function canEnterOnboardingStep(
  step: OnboardingStep,
  created: CreatedStand | null,
): boolean {
  return onboardingRequiresStand(step) ? created !== null : true;
}

export function advanceOnboarding(
  step: OnboardingStep,
  created: CreatedStand | null,
): OnboardingStep | null {
  const next = nextOnboardingStep(step);
  if (!next) return null;
  return canEnterOnboardingStep(next, created) ? next : null;
}
