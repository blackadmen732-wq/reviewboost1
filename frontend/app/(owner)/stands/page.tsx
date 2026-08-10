import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BottomNav } from "@/features/dashboard/bottom-nav";
import { ComingSoon } from "@/features/dashboard/coming-soon";
import { currentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Stands — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function StandsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/stands");

  return (
    <>
      <main className="mx-auto w-full max-w-lg px-5 pb-28 pt-8">
        <h1 className="mb-6 text-2xl font-semibold tracking-[-0.02em] text-ink">Stands</h1>
        <ComingSoon area="stands" />
      </main>
      <BottomNav />
    </>
  );
}
