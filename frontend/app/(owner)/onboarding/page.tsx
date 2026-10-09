import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthFrame } from "@/features/auth/auth-frame";
import { PUBLIC_PLANS } from "@/features/public/pricing-plans";
import { OnboardingFlow } from "@/features/onboarding/onboarding-flow";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Set up",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * `?plan=` is the plan this person chose on the public pricing page, carried
 * here so that finishing setup leads to the plan they picked rather than a
 * second round of choosing. Validated against the published plans: an id that
 * is not one of them is dropped, so the parameter can only ever name a real
 * plan and never reaches a query or a redirect as free text.
 */
function chosenPlanFrom(raw: string | undefined): string | null {
  if (!raw) return null;
  return PUBLIC_PLANS.some((plan) => plan.id === raw) ? raw : null;
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan } = await searchParams;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/onboarding");

  // Someone who already finished should never see setup again. Derived from a
  // real membership row rather than a "completed" flag, which drifts the moment
  // anything changes outside this flow.
  const { data: existing } = await supabase
    .from("organization_members")
    .select("org_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1);

  if (existing && existing.length > 0) redirect("/home");

  return (
    <AuthFrame align="start">
      <OnboardingFlow chosenPlan={chosenPlanFrom(plan)} />
    </AuthFrame>
  );
}
