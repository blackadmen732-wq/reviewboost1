import Link from "next/link";
import type { ReactNode } from "react";

import { ReviewBoostLogo } from "@/components/brand/reviewboost-logo";
import { Button } from "@/components/ui/button";
import {
  PUBLIC_FOOTER,
  PUBLIC_NAV,
  START_HREF,
  SIGN_IN_HREF,
} from "@/features/public/public-copy";

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="border-b border-border bg-canvas">
        <div className="mx-auto flex h-16 max-w-[1080px] items-center justify-between gap-4 px-5 sm:px-8">
          <Link
            href="/"
            className="rounded-[var(--radius-control)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
          >
            <ReviewBoostLogo pose="full" size="nav" />
          </Link>

          <nav className="hidden items-center gap-7 md:flex" aria-label="Public">
            {PUBLIC_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm font-medium text-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href={SIGN_IN_HREF}
              className="hidden text-sm font-medium text-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)] sm:inline"
            >
              Sign in
            </Link>
            <Button asChild variant="primary" size="sm" className="w-auto">
              <Link href={START_HREF}>Get started</Link>
            </Button>
          </div>
        </div>
        <nav
          className="mx-auto flex max-w-[1080px] flex-wrap gap-x-5 gap-y-2 px-5 pb-3 md:hidden sm:px-8"
          aria-label="Public"
        >
          {PUBLIC_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main>{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1080px] flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <ReviewBoostLogo pose="full" size="footer" />
          <nav className="flex flex-wrap gap-x-6 gap-y-3" aria-label="Legal">
            {PUBLIC_FOOTER.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
