import { Home, MessageSquare, QrCode, Sparkles, Star, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The destinations, defined once.
 *
 * The bottom bar and the desktop sidebar previously each carried their own copy
 * of this list, which meant adding a screen involved editing two files and
 * remembering both. They had not drifted yet only because nothing had been added
 * since they were written.
 *
 * WHY THE TWO NAVIGATIONS SHOW DIFFERENT THINGS
 * ---------------------------------------------
 * The phone bar holds four items and will never hold five. Past four, targets
 * shrink below what a thumb can hit reliably and people stop reading the bar and
 * start hunting — and a user who is hunting has decided the app is complicated.
 *
 * So the phone gets the four things an owner does *during a shift*: check
 * whether anything is wrong, read messages, see how they are doing, show or
 * print the code. The desktop sidebar has room for everything.
 *
 * Praise and Customers are the two that do not make the phone bar. Neither is
 * buried: both have a card on Home, and Praise turns amber there the moment
 * somebody is named, which surfaces it exactly when it matters instead of
 * occupying a permanent slot that is empty most days.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shows the unread count. Only ever one item — two badges is an alarm. */
  badge?: "unread";
}

export const HOME: NavItem = { href: "/home", label: "Home", icon: Home };
export const FEEDBACK: NavItem = {
  href: "/feedback",
  label: "Feedback",
  icon: MessageSquare,
  badge: "unread",
};
export const REVIEWS: NavItem = { href: "/reviews", label: "Reviews", icon: Star };
export const CUSTOMERS: NavItem = { href: "/customers", label: "Customers", icon: Users };
export const PRAISE: NavItem = { href: "/praise", label: "Praise", icon: Sparkles };
export const STANDS: NavItem = { href: "/stands", label: "Codes", icon: QrCode };

/** Phone. Exactly four, forever. */
export const MOBILE_NAV: readonly NavItem[] = [HOME, FEEDBACK, REVIEWS, STANDS];

/** Desktop. Room for the full set. */
export const DESKTOP_NAV: readonly NavItem[] = [
  HOME,
  FEEDBACK,
  REVIEWS,
  CUSTOMERS,
  PRAISE,
  STANDS,
];

/** Reachable from Home on a phone, because they are not in the bar there. */
export const HOME_SHORTCUTS: readonly NavItem[] = [PRAISE, CUSTOMERS];

/** Whether a nav item should read as the current screen. */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
