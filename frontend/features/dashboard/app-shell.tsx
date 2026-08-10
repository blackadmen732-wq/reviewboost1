import type { ReactNode } from "react";

import { BottomNav } from "@/features/dashboard/bottom-nav";
import { DesktopSidebar } from "@/features/dashboard/desktop-sidebar";

/**
 * The frame every owner screen sits in.
 *
 * Two genuinely different layouts rather than one responsive compromise,
 * because the two contexts are not variations of each other. On a phone this is
 * used standing up, one-handed, mid-shift — navigation belongs under the thumb.
 * On a desktop it is used sitting down at the end of the day, and a bottom bar
 * on a 27-inch monitor is a long way from where the eye already is.
 *
 * Content is capped at 1200px and stays left-aligned beside the sidebar. Text
 * stretched across a full monitor is unreadable, and a centred column with a
 * sidebar looks like it drifted loose.
 */
export function AppShell({
  children,
  unreadCount = 0,
  businessName,
}: {
  children: ReactNode;
  unreadCount?: number | undefined;
  // Explicitly `| undefined` rather than just optional: the project runs
  // exactOptionalPropertyTypes, which distinguishes "absent" from "present
  // and undefined", and callers pass the result of a lookup that may be either.
  businessName?: string | undefined;
}) {
  return (
    <div className="min-h-dvh bg-canvas">
      <DesktopSidebar unreadCount={unreadCount} businessName={businessName} />

      {/* The sidebar is fixed, so the content is pushed by a matching margin
          rather than sharing a flex row. That keeps the sidebar from scrolling
          away on a long page. */}
      <div className="lg:pl-[248px]">
        <main
          className={[
            "mx-auto w-full max-w-[1200px]",
            // Bottom padding clears the mobile nav bar; it is not needed once
            // the sidebar takes over.
            "px-5 pb-28 pt-8 lg:px-8 lg:pb-16 lg:pt-10",
          ].join(" ")}
        >
          {children}
        </main>
      </div>

      <BottomNav unreadCount={unreadCount} />
    </div>
  );
}
