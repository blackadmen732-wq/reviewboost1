import { Home, MessageSquare, QrCode, Send, Settings } from "lucide-react";
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
 * Reviews, Praise and Customers are historical views of data the V1 public
 * contract no longer collects. They remain as pages but are not in the nav.
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

/** Whether a nav item should read as the current screen. */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
