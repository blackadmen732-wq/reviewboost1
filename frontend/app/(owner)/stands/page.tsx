import type { Metadata } from "next";
import { QrCode } from "lucide-react";
import { redirect } from "next/navigation";

import { AppShell } from "@/features/dashboard/app-shell";
import { StandCard } from "@/features/dashboard/stand-card";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Your codes — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The codes an owner prints and puts on the counter.
 *
 * Called "Codes" everywhere a customer-facing word is needed. "Stand" is our
 * internal noun; the thing they are holding is a code.
 */
export default async function StandsPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/stands");

  const { data } = await supabase
    .from("review_stands")
    .select("id, label, status, public_token_prefix")
    .order("created_at", { ascending: false });

  const stands = data ?? [];

  return (
    <AppShell>
        <h1 className="mb-2 text-2xl font-semibold tracking-[-0.02em] text-ink">Your codes</h1>
        <p className="mb-6 text-base text-muted">Put these where customers pay.</p>

        {stands.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface px-6 py-16 text-center">
            <div className="grid size-16 place-items-center rounded-full bg-quiet">
              <QrCode className="size-8 text-muted" aria-hidden="true" />
            </div>
            <p className="text-lg font-semibold text-ink">No codes yet</p>
            <p className="max-w-[28ch] text-base text-muted">
              Finish setting up and your first code appears here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {stands.map((stand) => (
              <StandCard
                key={stand.id as string}
                standId={stand.id as string}
                label={stand.label as string}
                status={stand.status as string}
                tokenPrefix={stand.public_token_prefix as string}
              />
            ))}
          </div>
        )}
      </AppShell>
  );
}
