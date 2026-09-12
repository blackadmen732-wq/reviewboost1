import { Home, MessageSquare, QrCode, Settings, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Owner chrome destinations.
 *
 * Constitution IA for this slice:
 *   Desktop — Home / Feedback / Tags / Team / Settings
 *   Mobile  — Home / Feedback / Tags / Settings
 *
 * Tags is the existing /stands surface. Team is the existing /praise
 * surface. Those pages are not redesigned here; only the chrome labels
 * and which items appear in the bar change.
 *
 * Reviews and Customers stay as routes. They are not in main nav.
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
export const TAGS: NavItem = { href: "/stands", label: "Tags", icon: QrCode };
export const TEAM: NavItem = { href: "/praise", label: "Team", icon: Users };
export const SETTINGS: NavItem = { href: "/settings", label: "Settings", icon: Settings };

/** Phone. Exactly four. */
export const MOBILE_NAV: readonly NavItem[] = [HOME, FEEDBACK, TAGS, SETTINGS];

/** Desktop. Work dominates; this list recedes. */
export const DESKTOP_NAV: readonly NavItem[] = [HOME, FEEDBACK, TAGS, TEAM, SETTINGS];

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
