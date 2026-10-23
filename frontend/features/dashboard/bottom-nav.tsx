"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { MOBILE_NAV, isActive, mobileLabelOf } from "@/features/dashboard/nav-items";
import { badgeCount } from "@/features/dashboard/unread-memory";
import { cn } from "@/lib/utils/cn";

/**
 * Phone tabs. Four items, never five, each label on one line:
 * Home · Feedback · Texts · Tags.
 */
export function BottomNav({ unreadCount }: { unreadCount?: number | undefined }) {
  const pathname = usePathname();
  const unread = badgeCount(unreadCount);

  return (
    <nav
      aria-label="Main"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface",
        "lg:hidden",
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {MOBILE_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          const badge = item.badge === "unread" ? unread : 0;

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-16 flex-col items-center justify-center gap-1 px-1 py-2",
                  "text-xs font-medium transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
                  active ? "font-semibold text-ink" : "text-muted hover:text-ink",
                )}
              >
                <span className="relative">
                  <Icon
                    className="size-6"
                    strokeWidth={active ? 2.25 : 1.75}
                    aria-hidden="true"
                  />
                  {badge > 0 ? (
                    <span
                      className="absolute -right-2 -top-1 grid min-w-5 place-items-center rounded-full bg-ink px-1 text-xs font-semibold tabular-nums text-canvas"
                      role="img"
                      aria-label={`${badge} unread`}
                      data-unread-badge
                    >
                      {badge > 9 ? "9+" : badge}
                    </span>
                  ) : null}
                </span>
                {mobileLabelOf(item)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
