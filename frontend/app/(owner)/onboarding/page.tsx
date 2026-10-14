import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthFrame } from "@/features/auth/auth-frame";
import { OnboardingFlow } from "@/features/onboarding/onboarding-flow";
import { billingForPlan, parsePlanChoice } from "@/lib/owner/plan-choice";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Set up",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const selectedPlan = parsePlanChoice((await searchParams).plan);
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user)
    redirect(
      `/login?next=${encodeURIComponent(selectedPlan ? `/onboarding?plan=${selectedPlan}` : "/onboarding")}`,
    );

  // Someone who already finished should never see setup again. Derived from a
  // real membership row rather than a "completed" flag, which drifts the moment
  // anything changes outside this flow.
  const { data: existing, error } = await supabase
    .from("organization_members")
    .select("org_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1);

  if (error) throw new Error("Could not load your business. Please try again.");
  if (existing && existing.length > 0)
    redirect(selectedPlan ? billingForPlan(selectedPlan) : "/home");

  return (
    <AuthFrame align="start">
      <OnboardingFlow selectedPlan={selectedPlan} />
    </AuthFrame>
  );
}
