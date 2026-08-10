import type { Metadata } from "next";
import { MessageSquare, QrCode, Sparkles, Star } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { BottomNav } from "@/features/dashboard/bottom-nav";
import { StatTile } from "@/features/dashboard/stat-tile";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Home — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The screen an owner opens every morning.
 *
 * It answers one question — *is there anything I need to do?* — before they
 * have finished looking at it. Everything else is secondary and lives a tap
 * away.
 *
 * Data is read straight from Supabase rather than through our own REST API. The
 * session is already here, Row Level Security already scopes it, and an extra
 * HTTP hop to our own server would only add latency. The REST API exists for
 * clients that are not this app.
 */
export default async function HomePage() {
  const supabase = await supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/home");

  // RLS means these need no `where org_id` — the caller can only see their own
  // rows, and a missing clause returns fewer, never somebody else's.
  const { data: memberships } = await supabase
    .from("organization_members")
    .select("org_id, organizations(name)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1);

  const membership = memberships?.[0] as
    | { org_id: string; organizations: { name: string } | null }
    | undefined;

  // No organization yet means they have never finished setting up. Send them
  // there rather than showing an empty dashboard, which reads as "broken".
  if (!membership) redirect("/onboarding");

  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [today, unread, praise, stands, recent] = await Promise.all([
    supabase
      .from("customer_responses")
      .select("rating", { count: "exact" })
      .gte("submitted_at", since.toISOString()),
    supabase
      .from("customer_responses")
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
    supabase
      .from("team_praise_records")
      .select("id", { count: "exact", head: true })
      .eq("status", "unmatched")
      .gte("created_at", monthStart.toISOString()),
    supabase.from("review_stands").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase
      .from("customer_responses")
      .select("rating")
      .order("submitted_at", { ascending: false })
      .limit(50),
  ]);

  const todayCount = today.count ?? 0;
  const ratings = (recent.data ?? []).map((row) => row.rating as number);
  const average =
    ratings.length > 0
      ? (ratings.reduce((total, rating) => total + rating, 0) / ratings.length).toFixed(1)
      : null;

  const businessName = membership.organizations?.name ?? "Your business";
  const hasStand = (stands.count ?? 0) > 0;

  return (
    <>
      {/* pb-28 clears the fixed bottom bar. Content hidden behind navigation is
          the most common mobile layout bug and the hardest for a user to
          describe when they report it. */}
      <main className="mx-auto w-full max-w-lg px-5 pb-28 pt-8">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted">Today</p>
            <h1 className="truncate text-2xl font-semibold tracking-[-0.02em] text-ink">
              {businessName}
            </h1>
          </div>
          <Link
            href="/settings"
            aria-label="Settings"
            className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-surface text-base font-semibold text-ink transition-colors hover:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
          >
            {businessName.slice(0, 1).toUpperCase()}
          </Link>
        </header>

        {/* The headline number. One glance, from across a counter. */}
        <section className="mb-6 rounded-[var(--radius-card)] border border-border bg-surface p-6 text-center shadow-[var(--shadow-card)]">
          {average === null ? (
            <>
              <Star className="mx-auto mb-3 size-10 text-[color:var(--rb-border-strong)]" aria-hidden="true" />
              <p className="text-lg font-semibold text-ink">No ratings yet</p>
              <p className="mt-1 text-sm text-muted">
                Put your code on the counter and they will come in.
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center justify-center gap-2">
                <Star
                  className="size-9 fill-[color:var(--rb-star)] text-[color:var(--rb-star)]"
                  aria-hidden="true"
                />
                <span className="text-[3.5rem] font-semibold leading-none tabular-nums tracking-[-0.04em] text-ink">
                  {average}
                </span>
              </div>
              <p className="mt-3 text-base text-muted">
                {todayCount === 0
                  ? "No ratings today yet"
                  : `${todayCount} ${todayCount === 1 ? "rating" : "ratings"} today`}
              </p>
            </>
          )}
        </section>

        <section className="mb-8 grid grid-cols-2 gap-3">
          <StatTile
            value={unread.count ?? 0}
            label="To read"
            icon={MessageSquare}
            href="/feedback"
            needsAttention={(unread.count ?? 0) > 0}
          />
          <StatTile
            value={praise.count ?? 0}
            label="Praise"
            icon={Sparkles}
            href="/praise"
            needsAttention={(praise.count ?? 0) > 0}
          />
        </section>

        {/* Exactly one primary action, and it changes with what they still need
            to do. Two primary buttons is the same as none. */}
        <Button asChild size="lg">
          <Link href={hasStand ? "/stands" : "/onboarding"}>
            <QrCode className="size-5" aria-hidden="true" />
            {hasStand ? "Print your code" : "Finish setting up"}
          </Link>
        </Button>
      </main>

      <BottomNav unreadCount={unread.count ?? 0} />
    </>
  );
}
