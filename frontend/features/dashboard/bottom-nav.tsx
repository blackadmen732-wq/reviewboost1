"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { MOBILE_NAV, isActive } from "@/features/dashboard/nav-items";
import { cn } from "@/lib/utils/cn";

/**
 * Bottom navigation.
 *
 * Four items, never five — see `nav-items.ts` for why, and for where the screens
 * that do not fit are reachable instead.
 *
 * At the bottom rather than the top because this is used one-handed, standing
 * up, often while doing something else. The bottom third of a phone is the only
 * part a thumb reaches comfortably; a top nav bar on a large phone is a
 * two-handed control.
 *
 * Every item is an icon **and** a word. Icons alone are guessed wrong far more
 * often than designers assume, and this audience will not tap something to find
 * out what it does.
 */
export function BottomNav({ unreadCount = 0 }: { unreadCount?: number }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur",
        // The desktop sidebar takes over here. Both render always and CSS
        // decides, so there is no flash of the wrong navigation on first paint.
        "lg:hidden",
        "shadow-[var(--shadow-float)]",
        // Clears the iOS home indicator. Without this the last row of taps lands
        // on the system gesture area and appears to do nothing.
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {MOBILE_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          const badge = item.badge === "unread" ? unreadCount : 0;

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // 64px tall: comfortably above the 44px minimum, because the
                  // people using this are often moving.
                  "relative flex min-h-16 flex-col items-center justify-center gap-1 px-1 py-2",
                  "text-xs font-medium transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
                  active ? "text-brand-text" : "text-muted hover:text-ink",
                )}
              >
                <span className="relative">
                  <Icon
                    className="size-6"
                    // Weight change as well as colour, so the active item is
                    // distinguishable without relying on colour alone.
                    strokeWidth={active ? 2.5 : 2}
                    aria-hidden="true"
                  />
                  {badge > 0 ? (
                    <span
                      className="absolute -right-2 -top-1 grid min-w-5 place-items-center rounded-full bg-[color:var(--rb-star)] px-1 text-[0.6875rem] font-bold text-[#3d2a00]"
                      aria-label={`${badge} unread`}
                    >
                      {badge > 9 ? "9+" : badge}
                    </span>
                  ) : null}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
