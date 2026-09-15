import { Home, MessageSquare, QrCode, Send, Settings, Sparkles, Star, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The destinations, defined once.
 *
 * The bottom bar and the desktop sidebar previously each carried their own copy
 * of this list, which meant adding a screen involved editing two files and
 * remembering both. They had not drifted yet only because nothing had been added
 * since they were written.
 *
 * THE FOUR DESTINATIONS
 * ---------------------
 * Home, Feedback, Text Requests, Tags — plus Settings, which lives with the
 * profile rather than in the bar. That is the whole product an owner uses.
 *
 * The phone bar holds four items and will never hold five. Past four, targets
 * shrink below what a thumb can hit reliably and people stop reading the bar
 * and start hunting — and a user who is hunting has decided the app is
 * complicated.
 *
 * Reviews, Praise and Customers are not in the bar. They are historical views
 * of data the V1 public contract no longer collects, and they stay reachable
 * from Home and Settings so nothing a business already has becomes
 * unreachable — but they are not part of the daily loop, and giving them a
 * permanent slot would say they were.
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
/** The physical thing on the counter. "Tags" is what the product calls it. */
export const TAGS: NavItem = { href: "/stands", label: "Tags", icon: QrCode };
/** Text Requests. Never "campaigns": V1 sends review requests and nothing else. */
export const TEXT_REQUESTS: NavItem = {
  href: "/text-requests",
  label: "Text Requests",
  icon: Send,
};
export const SETTINGS: NavItem = { href: "/settings", label: "Settings", icon: Settings };

/** Phone. Exactly four, forever. */
export const MOBILE_NAV: readonly NavItem[] = [HOME, FEEDBACK, TEXT_REQUESTS, TAGS];

/** Desktop. The same four, plus Settings, which the phone reaches by profile. */
export const DESKTOP_NAV: readonly NavItem[] = [
  HOME,
  FEEDBACK,
  TEXT_REQUESTS,
  TAGS,
  SETTINGS,
];

/** Historical views, reachable from Home rather than from the bar. */
export const HOME_SHORTCUTS: readonly NavItem[] = [REVIEWS, PRAISE, CUSTOMERS];

/** Whether a nav item should read as the current screen. */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
