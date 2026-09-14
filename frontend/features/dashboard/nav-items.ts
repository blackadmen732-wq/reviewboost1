import { Home, MessageSquare, QrCode, Send } from "lucide-react";
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
export const TEXT_REQUESTS: NavItem = { href: "/text-requests", label: "Texts", icon: Send };
export const TAGS: NavItem = { href: "/stands", label: "Tags", icon: QrCode };

/** Phone bottom bar: four items. */
export const MOBILE_NAV: readonly NavItem[] = [HOME, FEEDBACK, TEXT_REQUESTS, TAGS];

/** Desktop sidebar. */
export const DESKTOP_NAV: readonly NavItem[] = [HOME, FEEDBACK, TEXT_REQUESTS, TAGS];

/** Whether a nav item should read as the current screen. */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
