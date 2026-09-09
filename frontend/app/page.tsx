import { redirect } from "next/navigation";

import { PublicHome } from "@/features/public/public-home";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The front door.
 *
 * Signed out: the public homepage.
 * Signed in, set up: Home.
 * Signed in, not set up: finish onboarding.
 *
 * The session is in a cookie the server can read, so signed-in owners never
 * flash the marketing page.
 */
export default async function RootPage() {
  const supabase = await supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <PublicHome />;
  }

  const { data: memberships } = await supabase
    .from("organization_members")
    .select("org_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1);

  redirect(memberships && memberships.length > 0 ? "/home" : "/onboarding");
}
