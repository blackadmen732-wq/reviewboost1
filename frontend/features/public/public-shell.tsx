import Link from "next/link";
import type { ReactNode } from "react";

import { ReviewBoostLogo } from "@/components/brand/reviewboost-logo";
import { PublicHeader } from "@/features/public/public-header";
import { PUBLIC_FOOTER } from "@/features/public/public-copy";

/**
 * Public chrome. `.rb-public` (public-showcase.css) scopes the website's
 * palette — cool neutrals, ReviewBoost green as the action — so the
 * authenticated app keeps its own tokens untouched.
 *
 * The bar and the footer take `.rb-public-dark`, the deep green-black that
 * also carries the hero, the customer-page showcase, pricing and the close.
 * The page opens and closes in the brand's own colour and the light bands sit
 * inside it. Same palette, different weighting.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="rb-public min-h-dvh bg-canvas text-ink">
      <PublicHeader />

      <main>{children}</main>

      <footer className="rb-public-dark border-t border-border bg-canvas text-ink">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
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
