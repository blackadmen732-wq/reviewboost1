import type { ReactNode } from "react";
import { Settings } from "lucide-react";
import Link from "next/link";

import { ReviewBoostLogo } from "@/components/brand/reviewboost-logo";
import { BottomNav } from "@/features/dashboard/bottom-nav";
import { DesktopSidebar } from "@/features/dashboard/desktop-sidebar";
import { PageTransition } from "@/features/dashboard/page-transition";

/**
 * Owner chrome. Nav recedes; the work column dominates.
 *
 * Desktop: light sidebar, five destinations.
 * Mobile: four tabs. Content is capped at 800px so a line of type does
 * not stretch across a monitor.
 */
export function OwnerShell({
  children,
  unreadCount = 0,
  businessName,
}: {
  children: ReactNode;
  unreadCount?: number | undefined;
  businessName?: string | undefined;
}) {
  return (
    <div className="min-h-dvh bg-canvas">
      <a href="#owner-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--radius-control)] focus:bg-surface focus:px-4 focus:py-3 focus:text-ink focus:outline focus:outline-2 focus:outline-focus">Skip to content</a>
      <DesktopSidebar unreadCount={unreadCount} businessName={businessName} />

      <div className="lg:pl-[220px]">
        <header
          className="mx-auto flex max-w-[var(--rb-content)] items-center justify-between px-5 pt-4 lg:hidden"
          aria-label="Account"
        >
          <Link
            href="/home"
            aria-label="ReviewBoost home"
            className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
          >
            <ReviewBoostLogo pose="full" size="footer" />
          </Link>
          <Link
            href="/settings"
            className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-2 text-sm font-medium text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
          >
            <Settings className="size-5" aria-hidden="true" />
            Settings
          </Link>
        </header>
        <main id="owner-content" tabIndex={-1} className="mx-auto w-full max-w-[var(--rb-content)] px-5 pb-28 pt-6 lg:px-8 lg:pb-16 lg:pt-12">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>

      <BottomNav unreadCount={unreadCount} />
    </div>
  );
}

/** @deprecated Use OwnerShell. Kept so existing owner routes compile. */
export const AppShell = OwnerShell;
