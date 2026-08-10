import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BottomNav } from "@/features/dashboard/bottom-nav";
import { ComingSoon } from "@/features/dashboard/coming-soon";
import { currentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Settings — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/settings");

  return (
    <>
      <main className="mx-auto w-full max-w-lg px-5 pb-28 pt-8">
        <h1 className="mb-6 text-2xl font-semibold tracking-[-0.02em] text-ink">Settings</h1>
        <ComingSoon area="settings" />
      </main>
      <BottomNav />
    </>
  );
}
