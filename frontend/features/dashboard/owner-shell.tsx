import type { ReactNode } from "react";

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
      <DesktopSidebar unreadCount={unreadCount} businessName={businessName} />

      <div className="lg:pl-[220px]">
        <main className="mx-auto w-full max-w-[var(--rb-content)] px-5 pb-28 pt-10 lg:px-8 lg:pb-16 lg:pt-12">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>

      <BottomNav unreadCount={unreadCount} />
    </div>
  );
}

/** @deprecated Use OwnerShell. Kept so existing owner routes compile. */
export const AppShell = OwnerShell;
