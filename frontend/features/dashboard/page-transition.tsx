"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Motion between screens.
 *
 * React's `<ViewTransition>` would be the right tool and is not available in
 * this build — `experimental.viewTransition` is not a flag Next 16 recognises
 * here, and React does not export the component. So this does the achievable
 * part: the incoming screen fades and lifts a few pixels into place.
 *
 * That covers the thing that actually reads as "web page" rather than "app" —
 * content appearing instantly, with no sense that one screen replaced another.
 * It cannot morph a shared element between routes, which is what the real API
 * would add.
 *
 * Keyed on the pathname, so React remounts the subtree on navigation and the
 * animation runs. Deliberately short: 180ms is felt but not waited for, and
 * anything past about 250ms starts costing a busy owner real time on every tap.
 *
 * The navigation chrome sits outside this on purpose. A tab bar that faded on
 * every tap would feel unstable, and it is the one fixed point on the screen.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div
      key={pathname}
      className="animate-page-enter motion-reduce:animate-none"
    >
      {children}
    </div>
  );
}
