import type { Metadata } from "next";
import { ChevronRight, MessageSquare, QrCode, Sparkles, Star } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { AppShell } from "@/features/dashboard/app-shell";
import { InstallPrompt } from "@/features/dashboard/install-prompt";
import { HOME_SHORTCUTS } from "@/features/dashboard/nav-items";
import { StatusBanner } from "@/features/dashboard/status-banner";
import { StatTile } from "@/features/dashboard/stat-tile";
import { getOwnerCounts, localHour, requireOwner } from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Home — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The screen an owner opens every morning.
 *
 * It answers one question — *is there anything I need to do?* — before they have
 * finished looking at it. Everything else is secondary and lives a tap away.
 *
 * Data comes from the shared owner data layer rather than queries written here.
 * That layer reads Supabase directly instead of going through our own REST API:
 * the session is already present, RLS already scopes it, and an extra HTTP hop
 * to our own server would only add latency. The REST API exists for clients that
 * are not this app.
 */
export default async function HomePage() {
  const { organization } = await requireOwner("/home");
  const counts = await getOwnerCounts(organization.orgId, organization.timezone);

  const hour = localHour(organization.timezone);
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const average = counts.recentAverage?.toFixed(1) ?? null;
  const hasStand = counts.activeStands > 0;

  // One status, most urgent first. A code that cannot serve customers beats
  // unread messages, which beat silence. Showing two problems at once turns the
  // screen into a list, and a list is homework.
  const status =
    !counts.hasGoogleLink || !hasStand
      ? ({ kind: "setup", href: "/onboarding" } as const)
      : counts.unread > 0
        ? ({ kind: "unread", count: counts.unread, href: "/feedback" } as const)
        : counts.ratingsToday === 0 && counts.recentCount === 0
          ? ({ kind: "quiet", href: "/stands" } as const)
          : ({ kind: "ok" } as const);

  return (
    <AppShell unreadCount={counts.unread} businessName={organization.name}>
      <InstallPrompt />

      <header className="mb-8 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted">{greeting}</p>
          <h1 className="truncate text-2xl font-semibold tracking-[-0.02em] text-ink lg:text-3xl">
            {organization.name}
          </h1>
        </div>
        <Link
          href="/settings"
          aria-label="Settings"
          // Hidden on desktop: the sidebar already carries the account row, and
          // two ways to reach the same place is two things to scan past.
          className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-surface text-base font-semibold text-ink transition-colors hover:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)] lg:hidden"
        >
          {organization.name.slice(0, 1).toUpperCase()}
        </Link>
      </header>

      <StatusBanner status={status} />

      {/* The rating is context, not the headline. It sits below the answer to
          "is anything wrong", because that is the question people open this
          screen to ask. */}
      <div className="mb-8 grid gap-4 lg:grid-cols-[1fr_1fr] lg:items-stretch">
        <Link
          href="/reviews"
          className="rounded-[var(--radius-card)] border border-border bg-surface p-6 text-center shadow-[var(--shadow-card)] transition-transform duration-150 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)] motion-reduce:active:scale-100 lg:flex lg:flex-col lg:justify-center lg:p-10"
        >
          {average === null ? (
            <>
              <Star
                className="mx-auto mb-3 size-10 text-[color:var(--rb-border-strong)]"
                aria-hidden="true"
              />
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
                {counts.ratingsToday === 0
                  ? "No ratings today yet"
                  : `${counts.ratingsToday} ${counts.ratingsToday === 1 ? "rating" : "ratings"} today`}
              </p>
            </>
          )}
        </Link>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-1 lg:gap-4">
          <StatTile
            value={counts.unread}
            label="To read"
            icon={MessageSquare}
            href="/feedback"
            needsAttention={counts.unread > 0}
          />
          <StatTile
            value={counts.unmatchedPraise}
            label="Praise"
            icon={Sparkles}
            href="/praise"
            needsAttention={counts.unmatchedPraise > 0}
          />
        </section>
      </div>

      {/* Exactly one primary action, and it changes with what they still need to
          do. Two primary buttons is the same as none. */}
      <Button asChild size="lg" className="lg:w-auto lg:min-w-[280px]">
        <Link href={hasStand ? "/stands" : "/onboarding"}>
          <QrCode className="size-5" aria-hidden="true" />
          {hasStand ? "Print your code" : "Finish setting up"}
        </Link>
      </Button>

      {/* The screens that do not fit in the four-item phone bar. Hidden on
          desktop, where the sidebar already lists them and a second route to the
          same place is just one more thing to scan past. */}
      <nav aria-label="More" className="mt-8 flex flex-col gap-2 lg:hidden">
        {HOME_SHORTCUTS.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex min-h-14 items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface px-4 transition-colors hover:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-quiet">
                <Icon className="size-4.5 text-muted" aria-hidden="true" />
              </span>
              <span className="flex-1 text-base font-medium text-ink">{item.label}</span>
              <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden="true" />
            </Link>
          );
        })}
      </nav>
    </AppShell>
  );
}
