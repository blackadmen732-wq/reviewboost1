import { Home, MessageSquare, QrCode, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";

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
export const SETTINGS: NavItem = { href: "/settings", label: "Settings", icon: Settings };

/** Phone bottom bar: four items. */
export const MOBILE_NAV: readonly NavItem[] = [HOME, FEEDBACK, TAGS, SETTINGS];

/** Desktop sidebar. */
export const DESKTOP_NAV: readonly NavItem[] = [HOME, FEEDBACK, TAGS, SETTINGS];

/** Whether a nav item should read as the current screen. */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
