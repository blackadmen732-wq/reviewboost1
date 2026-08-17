import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OnboardingFlow } from "@/features/onboarding/onboarding-flow";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Set up — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
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
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <OnboardingFlow />
    </main>
  );
}
