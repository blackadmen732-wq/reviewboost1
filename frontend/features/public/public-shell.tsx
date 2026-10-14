import Link from "next/link";
import { Menu } from "lucide-react";
import type { ReactNode } from "react";

import { ReviewBoostLogo } from "@/components/brand/reviewboost-logo";
import { Button } from "@/components/ui/button";
import { publicEditorialFont } from "@/lib/fonts/public-editorial";
import {
  PUBLIC_FOOTER,
  PUBLIC_NAV,
  START_HREF,
  SIGN_IN_HREF,
} from "@/features/public/public-copy";

/**
 * Public chrome. Recedes. The page does the talking.
 *
 * Desktop: text links and one Action button.
 * Mobile: every public destination remains available in a native disclosure.
 */
export function PublicShell({
  children,
  homepage = false,
  currentPath,
}: {
  children: ReactNode;
  homepage?: boolean;
  currentPath?: string | undefined;
}) {
  return (
    <div
      className={`public-shell min-h-dvh bg-canvas text-ink ${publicEditorialFont.variable}${homepage ? " public-shell--home" : ""}`}
    >
      <header className="public-header border-b border-border bg-canvas">
        <div className="public-header__row mx-auto flex h-16 max-w-[1080px] items-center justify-between gap-4 px-5 sm:px-8">
          <Link
            href="/"
            aria-label="ReviewBoost home"
            aria-current={currentPath === "/" ? "page" : undefined}
            className="rounded-[var(--radius-control)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
          >
            <ReviewBoostLogo pose="full" size="nav" />
          </Link>

          <nav
            className="hidden items-center gap-7 md:flex"
            aria-label="Public"
          >
            {PUBLIC_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={currentPath === item.href ? "page" : undefined}
                className="text-sm font-medium text-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href={SIGN_IN_HREF}
              className="hidden text-sm font-medium text-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)] sm:inline"
            >
              Sign in
            </Link>
            <Button asChild variant="action" size="sm" className="w-auto">
              <Link href={START_HREF}>Get started</Link>
            </Button>
            <details className="public-mobile-menu md:hidden">
              <summary className="public-mobile-menu__trigger">
                <Menu className="size-5" aria-hidden="true" />
                <span className="sr-only">Browse ReviewBoost</span>
              </summary>
              <nav
                className="public-mobile-menu__links"
                aria-label="Public mobile"
              >
                {PUBLIC_NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={
                      currentPath === item.href ? "page" : undefined
                    }
                  >
                    {item.label}
                  </Link>
                ))}
                <Link href={SIGN_IN_HREF}>Sign in</Link>
                <Link href={START_HREF}>Get started</Link>
              </nav>
            </details>
          </div>
        </div>
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
