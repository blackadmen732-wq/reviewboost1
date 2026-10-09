"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { MOBILE_NAV, isActive, mobileLabelOf } from "@/features/dashboard/nav-items";
import { cn } from "@/lib/utils/cn";

/**
 * Phone tabs. Four items, never five, each label on one line:
 * Home · Feedback · Texts · Tags.
 *
 * THE ACTIVE STATE IS A PILL
 * --------------------------
 * It used to be a quarter-point of extra stroke weight and a colour change,
 * which on a phone in daylight is close to no signal at all — the one thing a
 * bar has to answer is "where am I", and this bar answered it in a whisper.
 *
 * A soft pill behind the icon says it at a glance and survives both themes.
 * Not a filled icon: three of these four fill cleanly and QrCode becomes a
 * solid block, and a bar whose items are styled by whichever icon happens to
 * fill is not a system. The pill works for any icon the bar ever holds.
 */
export function BottomNav({ unreadCount = 0 }: { unreadCount?: number }) {
  const pathname = usePathname();

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
          const badge = item.badge === "unread" ? unreadCount : 0;

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-16 flex-col items-center justify-center gap-1 px-1 py-2",
                  "text-xs transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
                  active ? "font-semibold text-ink" : "font-medium text-muted hover:text-ink",
                )}
              >
                <span
                  className={cn(
                    "relative grid h-8 w-16 place-items-center rounded-full",
                    "transition-colors duration-150",
                    active ? "bg-brand-soft" : "bg-transparent",
                  )}
                >
                  <Icon
                    className={cn("size-6", active && "text-brand-text")}
                    strokeWidth={active ? 2.25 : 1.75}
                    aria-hidden="true"
                  />
                  {badge > 0 ? (
                    <span
                      className="absolute right-3 top-0 grid min-w-5 place-items-center rounded-full bg-ink px-1 text-[0.6875rem] font-semibold text-canvas"
                      aria-label={`${badge} unread`}
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
