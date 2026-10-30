import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The way back up one level, drawn the same on every screen that has one.
 *
 * Each screen used to make its own: an arrow on a rating, a chevron on
 * Connections, a bare 18px word on a Tag, and nothing at all on Billing, so
 * a phone user who reached Billing from Settings had only the browser to get
 * back. 44px tall, so it is a target and not just a word.
 */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="-ml-2 mb-4 inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-sm font-medium text-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
      data-back-link
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {children}
    </Link>
  );
}
