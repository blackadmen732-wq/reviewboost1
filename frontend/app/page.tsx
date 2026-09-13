import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LandingPage } from "@/features/landing/landing-page";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: {
    absolute: "ReviewBoost — More Google reviews, without the work",
  },
  description:
    "Your customers scan a tag on your counter. One tap, and they're leaving you a review on Google. Set up in two minutes, free to start.",
};

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const supabase = await supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return <LandingPage />;

  const { data: memberships } = await supabase
    .from("organization_members")
    .select("org_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1);

  redirect(memberships && memberships.length > 0 ? "/home" : "/onboarding");
}
