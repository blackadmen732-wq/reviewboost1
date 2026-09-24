"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ReviewBoostLogo } from "@/components/brand/reviewboost-logo";
import { DESKTOP_NAV, isActive } from "@/features/dashboard/nav-items";
import { cn } from "@/lib/utils/cn";

/**
 * Desktop navigation. A white rail on the neutral canvas — quiet on purpose,
 * because the page is the product. The active destination is a soft pill;
 * everything else is plain text that darkens on hover.
 */
export function DesktopSidebar({
  unreadCount = 0,
  businessName,
}: {
  unreadCount?: number | undefined;
  businessName?: string | undefined;
}) {
  const pathname = usePathname();

  return (
    <aside
      aria-label="Main"
      className="fixed inset-y-0 left-0 z-40 hidden w-[240px] flex-col border-r border-border bg-surface lg:flex"
    >
      <div className="flex h-20 items-center px-5">
        <Link
          href="/home"
          aria-label="ReviewBoost home"
          className="rounded-[var(--radius-control)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          <ReviewBoostLogo pose="full" size="nav" />
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
                    "flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3",
                    "text-[0.9375rem] transition-colors duration-150",
                    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
                    active
                      ? "bg-quiet font-semibold text-ink"
                      : "font-medium text-muted hover:bg-quiet/60 hover:text-ink",
                  )}
                >
                  <Icon className="size-5" strokeWidth={active ? 2.25 : 1.75} aria-hidden="true" />
                  <span className="flex-1">{item.label}</span>

                  {badge > 0 ? (
                    <span
                      className="grid min-w-6 place-items-center rounded-full bg-ink px-1.5 text-xs font-semibold text-canvas"
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

      <div className="border-t border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-quiet text-sm font-semibold text-ink"
          >
            {(businessName ?? "Y").trim().charAt(0).toUpperCase()}
          </span>
          <p className="truncate text-sm font-medium text-ink">{businessName ?? "Your business"}</p>
        </div>
      </div>
    </aside>
  );
}
