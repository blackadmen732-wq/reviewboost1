import type { Metadata } from "next";
import { MessageSquare, QrCode } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { AppShell } from "@/features/dashboard/app-shell";
import { InstallPrompt } from "@/features/dashboard/install-prompt";
import { StatusBanner } from "@/features/dashboard/status-banner";
import { StatTile } from "@/features/dashboard/stat-tile";
import { getOwnerCounts, localHour, requireOwner } from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Home — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { organization } = await requireOwner("/home");
  const counts = await getOwnerCounts(organization.orgId, organization.timezone);

  const hour = localHour(organization.timezone);
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const hasStand = counts.activeStands > 0;

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
          className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-surface text-base font-semibold text-ink transition-colors hover:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)] lg:hidden"
        >
          {organization.name.slice(0, 1).toUpperCase()}
        </Link>
      </header>

      <StatusBanner status={status} />

      <section className="mb-8 grid grid-cols-2 gap-3 lg:gap-4">
        <StatTile
          value={counts.unread}
          label="To read"
          icon={MessageSquare}
          href="/feedback"
          needsAttention={counts.unread > 0}
        />
        <StatTile
          value={counts.activeStands}
          label="Active tags"
          icon={QrCode}
          href="/stands"
        />
      </section>

      <Button asChild size="lg" className="lg:w-auto lg:min-w-[280px]">
        <Link href={hasStand ? "/stands" : "/onboarding"}>
          <QrCode className="size-5" aria-hidden="true" />
          {hasStand ? "Manage your tags" : "Finish setting up"}
        </Link>
      </Button>
    </AppShell>
  );
}
