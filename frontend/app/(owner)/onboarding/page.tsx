import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthFrame } from "@/features/auth/auth-frame";
import { ProviderAccountNotice } from "@/features/auth/provider-account-notice";
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

  // Arrived through Apple or Google with no business yet: make sure this is
  // not an existing owner who reached a fresh account by another door.
  const provider = user.app_metadata?.provider;
  const viaProvider = provider === "apple" || provider === "google" ? provider : null;

  return (
    <AuthFrame align="start">
      {viaProvider ? <ProviderAccountNotice provider={viaProvider} email={user.email ?? null} /> : null}
      <OnboardingFlow selectedPlan={selectedPlan} />
    </AuthFrame>
  );
}
