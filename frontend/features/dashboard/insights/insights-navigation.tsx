"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useState,
  useTransition,
  type MouseEvent,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Changing the period or the place, without the page snapping.
 *
 * A filter is a new URL, and the server draws the new figures. Left to a plain
 * link the screen sat unchanged for the length of the request and then every
 * number, the line and the bars were swapped in one frame — a tap that seemed
 * to do nothing, followed by a jump.
 *
 * Here the navigation runs as a transition, so React keeps the figures already
 * on screen until the new ones are ready (no skeleton, no layout jump). The
 * control answers the tap at once, the figures underneath dim while they are
 * out of date, and come back up as the new ones land. The bars keep their
 * elements across the change, so each one resizes to its new count. Nothing
 * waits on the motion: the request starts on the tap.
 */

interface InsightsNavigation {
  pending: boolean;
  /** The URL being loaded, so a control can show the choice before it lands. */
  target: string | null;
  go: (href: string) => void;
}

const Context = createContext<InsightsNavigation | null>(null);

export function InsightsNavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<string | null>(null);

  const go = (href: string) => {
    setTarget(href);
    startTransition(() => {
      router.push(href, { scroll: false });
    });
  };

  return (
    <Context.Provider value={{ pending, target: pending ? target : null, go }}>
      {children}
    </Context.Provider>
  );
}

export function useInsightsNavigation(): InsightsNavigation {
  const router = useRouter();
  const value = useContext(Context);
  // Outside the provider a filter is a plain navigation.
  return value ?? { pending: false, target: null, go: (href) => router.push(href, { scroll: false }) };
}

/** The figures a filter scopes: dimmed while they no longer match the filter. */
export function InsightsFigures({ children }: { children: ReactNode }) {
  const { pending } = useInsightsNavigation();
  return (
    <div
      className={cn(
        "flex flex-col gap-6 transition-opacity ease-out",
        pending ? "opacity-55 duration-150" : "opacity-100 duration-200",
      )}
      aria-busy={pending || undefined}
      data-insights-figures
    >
      {children}
    </div>
  );
}

/**
 * 7 · 30 · 90 days. The ink segment slides to the chosen period on the tap,
 * before the new figures arrive.
 */
export function PeriodSwitch({
  options,
}: {
  options: ReadonlyArray<{ label: string; href: string; current: boolean }>;
}) {
  const { target, go } = useInsightsNavigation();
  const chosen = Math.max(
    0,
    target !== null
      ? options.findIndex((option) => option.href === target)
      : options.findIndex((option) => option.current),
  );

  const onClick = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    // Let the browser handle a new tab or window.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    go(href);
  };

  return (
    <nav aria-label="Period">
      <ul
        className="relative grid rounded-full border border-border bg-surface p-1 sm:inline-grid"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {/* One pill for the whole control, moved rather than redrawn. */}
        <li
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-1 left-1 rounded-full bg-ink transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]"
          style={{
            width: `calc((100% - 0.5rem) / ${options.length})`,
            transform: `translateX(${chosen * 100}%)`,
          }}
          data-period-pill
        />
        {options.map((option, index) => (
          <li key={option.href} className="relative">
            <Link
              href={option.href}
              scroll={false}
              onClick={(event) => onClick(event, option.href)}
              aria-current={option.current ? "true" : undefined}
              className={cn(
                "flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-medium tabular-nums transition-colors duration-200",
                "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
                index === chosen ? "text-canvas" : "text-muted hover:text-ink",
              )}
            >
              {option.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
