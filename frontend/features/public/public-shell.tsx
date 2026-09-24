import Link from "next/link";
import type { ReactNode } from "react";

import { ReviewBoostLogo } from "@/components/brand/reviewboost-logo";
import { PublicHeader } from "@/features/public/public-header";
import { PUBLIC_FOOTER } from "@/features/public/public-copy";

/**
 * Public chrome. Figma "navbar-container" sets the visual direction for the
 * marketing site: warm off-white bar (#f5f6f0), hairline rule (#e1e5dc),
 * pill CTA. The authenticated app (dashboard, customer flow) keeps the
 * locked constitution tokens untouched — this palette is scoped to the
 * marketing shell only.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#f5f6f0] text-[#1b2a1e]">
      <PublicHeader />

      <main>{children}</main>

      <footer className="border-t border-[#e1e5dc] bg-[#f5f6f0]">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <ReviewBoostLogo pose="full" size="footer" />
          <nav className="flex flex-wrap gap-x-6 gap-y-3" aria-label="Legal">
            {PUBLIC_FOOTER.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-[#4a5d4e] transition-colors duration-150 hover:text-[#1b2a1e] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
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
