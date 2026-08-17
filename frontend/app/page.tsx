import { redirect } from "next/navigation";

import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The front door.
 *
 * This did not exist, which meant typing the domain — or opening the bare URL
 * in front of a customer — produced a 404. The installed app was fine because
 * its start_url points at /home, so the hole was invisible right up until
 * someone typed the address.
 *
 * THE SPLASH SCREEN THAT ISN'T ONE
 * --------------------------------
 * A native app shows a splash because it has to boot a runtime before it can
 * decide anything. We do not: the session is in a cookie the server can read,
 * so the decision happens before a single byte of UI is sent. The person taps
 * the icon and lands on the right screen — no logo animation, no spinner, no
 * flash of the wrong page.
 *
 * Faster than a splash screen, and it took less code than building one.
 *
 * Three states, in the order they matter:
 *   signed in, set up      → straight to work
 *   signed in, not set up  → finish what they started
 *   signed out             → sign in
 */
export default async function RootPage() {
  const supabase = await supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Whether setup finished is derived from a real membership row rather than a
  // stored flag. A flag drifts the moment anything changes outside onboarding,
  // and then someone who has finished is told to start again.
  const { data: memberships } = await supabase
    .from("organization_members")
    .select("org_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1);

  redirect(memberships && memberships.length > 0 ? "/home" : "/onboarding");
}
