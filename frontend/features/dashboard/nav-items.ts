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
 * On the phone bar the third one reads "Texts": "Text Requests" wrapped onto
 * two lines at 320px and made that tab taller than the other three. The
 * feature, its route, its page title and the desktop sidebar keep the full
 * name — only the bar's label is short.
 *
 * The phone bar holds four items and will never hold five. Past four, targets
 * shrink below what a thumb can hit reliably and people stop reading the bar
 * and start hunting — and a user who is hunting has decided the app is
 * complicated.
 *
 * Insights is not a destination either: it is a tab inside Feedback
 * (/feedback/insights), so the bar never grows an "Analytics". The old Reviews
 * page redirects there. Praise and Customers are historical views of data the
 * V1 public contract no longer collects; they remain as pages, not in the nav.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shows the unread count. Only ever one item — two badges is an alarm. */
  badge?: "unread";
  /**
   * The phone bar's label, where the full one does not fit a quarter of a
   * 320px screen on one line. Everywhere else — the sidebar, the page title —
   * uses `label`.
   */
  mobileLabel?: string;
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
  mobileLabel: "Texts",
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

/** What the phone bar shows for an item. */
export function mobileLabelOf(item: NavItem): string {
  return item.mobileLabel ?? item.label;
}

/** Whether a nav item should read as the current screen. */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
