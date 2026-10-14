import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PublicHome } from "@/features/public/public-home";
import { PUBLIC_HERO } from "@/features/public/public-copy";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "ReviewBoost" },
  description: PUBLIC_HERO.lede,
};

/**
 * The front door.
 *
 * Signed out: the public homepage.
 * Signed in, set up: Home.
 * Signed in, not set up: finish onboarding.
 *
 * If the session check fails, show the public page rather than a 500 —
 * a cold visitor should still be able to read the product.
 */
export default async function RootPage() {
  let signedIn = false;
  let hasMembership = false;

  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      signedIn = true;
      const { data: memberships } = await supabase
        .from("organization_members")
        .select("org_id")
        .eq("user_id", user.id)
        .eq("status", "active")
        .limit(1);
      hasMembership = Boolean(memberships && memberships.length > 0);
    }
  } catch {
    signedIn = false;
  }

  if (!signedIn) {
    return <PublicHome />;
  }

  redirect(hasMembership ? "/home" : "/onboarding");
}
