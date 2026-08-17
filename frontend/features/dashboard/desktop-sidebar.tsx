"use client";

import { Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Wordmark } from "@/components/brand/wordmark";
import { DESKTOP_NAV, isActive } from "@/features/dashboard/nav-items";
import { cn } from "@/lib/utils/cn";

/**
 * Desktop navigation.
 *
 * Hidden below `lg`, where the bottom bar takes over. Both are always rendered
 * and CSS decides — no viewport detection in JavaScript, so there is no flash of
 * the wrong navigation on first paint.
 *
 * Carries every screen, unlike the phone bar. A sidebar has vertical room, and
 * scanning a list of six at rest costs nothing; four is a constraint of the
 * thumb, not of comprehension.
 *
 * Settings is not in the list. It lives in the account row at the bottom, where
 * every desktop product has trained people to look for it.
 */

export function DesktopSidebar({
  unreadCount = 0,
  businessName,
}: {
  unreadCount?: number | undefined;
  // Explicitly `| undefined` rather than just optional: the project runs
  // exactOptionalPropertyTypes, which distinguishes "absent" from "present
  // and undefined", and callers pass the result of a lookup that may be either.
  businessName?: string | undefined;
}) {
  const pathname = usePathname();

  return (
    <aside
      aria-label="Main"
      className={cn(
        "fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-border bg-surface lg:flex",
      )}
    >
      <div className="flex h-[72px] items-center px-6">
        <Link
          href="/home"
          aria-label="ReviewBoost home"
          className="rounded-[var(--radius-control)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          <Wordmark size="md" />
        </Link>
      </div>

      <nav className="flex-1 px-3 py-2">
        <ul className="flex flex-col gap-1">
          {DESKTOP_NAV.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            const badge = item.badge === "unread" ? unreadCount : 0;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-12 items-center gap-3 rounded-[var(--radius-control)] px-3",
                    "text-[0.9375rem] font-medium transition-colors duration-150",
                    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
                    active
                      ? "bg-brand-soft text-brand-text"
                      : "text-muted hover:bg-quiet hover:text-ink",
                  )}
                >
                  <Icon className="size-5" strokeWidth={active ? 2.5 : 2} aria-hidden="true" />
                  <span className="flex-1">{item.label}</span>

                  {badge > 0 ? (
                    <span
                      className="grid min-w-6 place-items-center rounded-full bg-[color:var(--rb-star)] px-1.5 text-xs font-bold text-[#2b1c00]"
                      aria-label={`${badge} unread`}
                    >
                      {badge > 99 ? "99+" : badge}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* The account row sits at the bottom, where every desktop product has
          trained people to look for it. */}
      <div className="border-t border-border p-3">
        <Link
          href="/settings"
          className={cn(
            "flex min-h-14 items-center gap-3 rounded-[var(--radius-control)] px-3",
            "transition-colors duration-150 hover:bg-quiet",
            "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
            pathname.startsWith("/settings") && "bg-quiet",
          )}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand-text">
            {(businessName ?? "R").slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">
              {businessName ?? "Your business"}
            </span>
            <span className="block text-xs text-muted">Settings</span>
          </span>
          <Settings className="size-4 shrink-0 text-muted" aria-hidden="true" />
        </Link>
      </div>
    </aside>
  );
}
