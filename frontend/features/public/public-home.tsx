import Link from "next/link";

import { Button } from "@/components/ui/button";
import { PricingTable } from "@/features/public/pricing-table";
import {
  CLOSE,
  HOW_IT_WORKS,
  INTEGRITY,
  PRICING,
  PRIVACY,
  PRODUCT,
  PUBLIC_HERO,
  SECURITY,
  START_HREF,
} from "@/features/public/public-copy";
import { PublicShell } from "@/features/public/public-shell";

/**
 * Signed-out homepage. One idea per band. No testimonials, no invented counts.
 */
export function PublicHome() {
  return (
    <PublicShell>
      <section className="mx-auto max-w-[40rem] px-5 pb-20 pt-16 sm:px-8 sm:pb-28 sm:pt-24">
        <h1 className="text-[2.25rem] font-semibold leading-[1.15] tracking-[-0.035em] text-ink sm:text-[2.5rem]">
          {PUBLIC_HERO.title}
        </h1>
        <p className="mt-5 max-w-[38ch] text-lg leading-relaxed text-muted">{PUBLIC_HERO.lede}</p>
        <div className="mt-10 flex max-w-xs flex-col gap-3">
          <Button asChild variant="action" size="lg">
            <Link href={PUBLIC_HERO.primary.href}>{PUBLIC_HERO.primary.label}</Link>
          </Button>
          <Button asChild variant="ghost" size="lg">
            <Link href={PUBLIC_HERO.secondary.href}>{PUBLIC_HERO.secondary.label}</Link>
          </Button>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto max-w-[40rem] px-5 py-20 sm:px-8 sm:py-24">
          <p className="text-sm font-medium text-muted">How it works</p>
          <ol className="mt-8 flex flex-col gap-10">
            {HOW_IT_WORKS.map((step, index) => (
              <li key={step.title} className="flex gap-5">
                <span className="w-6 shrink-0 text-sm font-semibold text-muted">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h2 className="text-[length:var(--rb-text-title)] font-semibold tracking-[-0.02em] text-ink">
                    {step.title}
                  </h2>
                  <p className="mt-2 max-w-[36ch] text-base leading-relaxed text-muted">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-10">
            <Link
              href="/how-it-works"
              className="text-sm font-medium text-muted underline-offset-4 transition-colors duration-150 hover:text-ink hover:underline"
            >
              The whole path
            </Link>
          </p>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto max-w-[40rem] px-5 py-20 sm:px-8 sm:py-24">
          <p className="text-sm font-medium text-muted">Product</p>
          <h2 className="mt-4 text-[length:var(--rb-text-title)] font-semibold tracking-[-0.02em] text-ink">
            {PRODUCT.headline}
          </h2>
          <p className="mt-3 max-w-[40ch] text-base leading-relaxed text-muted">{PRODUCT.lede}</p>
          <ul className="mt-10 flex flex-col gap-8">
            {PRODUCT.items.map((item) => (
              <li key={item.title}>
                <h3 className="text-base font-semibold text-ink">{item.title}</h3>
                <p className="mt-2 max-w-[38ch] text-base leading-relaxed text-muted">{item.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-10">
            <Link
              href="/product"
              className="text-sm font-medium text-muted underline-offset-4 transition-colors duration-150 hover:text-ink hover:underline"
            >
              Tags in full
            </Link>
          </p>
        </div>
      </section>

      <section className="border-t border-border bg-quiet">
        <div className="mx-auto max-w-[40rem] px-5 py-20 sm:px-8 sm:py-24">
          <p className="text-sm font-medium text-muted">Integrity</p>
          <h2 className="mt-4 text-[length:var(--rb-text-title)] font-semibold tracking-[-0.02em] text-ink">
            {INTEGRITY.headline}
          </h2>
          <p className="mt-4 max-w-[40ch] text-base leading-relaxed text-muted">{INTEGRITY.lede}</p>
          <p className="mt-3 max-w-[40ch] text-base leading-relaxed text-muted">{INTEGRITY.body}</p>
          <p className="mt-10">
            <Link
              href="/integrity"
              className="text-sm font-medium text-muted underline-offset-4 transition-colors duration-150 hover:text-ink hover:underline"
            >
              Why this is the product
            </Link>
          </p>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto max-w-[40rem] px-5 py-20 sm:px-8 sm:py-24">
          <p className="text-sm font-medium text-muted">Pricing</p>
          <h2 className="mt-4 text-[length:var(--rb-text-title)] font-semibold tracking-[-0.02em] text-ink">
            {PRICING.headline}
          </h2>
          <p className="mt-3 max-w-[36ch] text-base leading-relaxed text-muted">{PRICING.lede}</p>

          {/* The prices themselves. This section used to be a headline, a lede
              and a link — a pricing section with no prices in it, which is the
              one question a visitor came to answer. */}
          <div className="mt-10">
            <PricingTable />
          </div>

          <p className="mt-6 max-w-[48ch] text-sm leading-relaxed text-muted">{PRICING.caveat}</p>
          <p className="mt-10">
            <Link
              href="/pricing"
              className="text-sm font-medium text-muted underline-offset-4 transition-colors duration-150 hover:text-ink hover:underline"
            >
              How we charge
            </Link>
          </p>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto max-w-[40rem] px-5 py-20 sm:px-8 sm:py-24">
          <p className="text-sm font-medium text-muted">Security and privacy</p>
          <h2 className="mt-4 text-[length:var(--rb-text-title)] font-semibold tracking-[-0.02em] text-ink">
            {SECURITY.headline}
          </h2>
          <p className="mt-3 max-w-[40ch] text-base leading-relaxed text-muted">{SECURITY.lede}</p>
          <p className="mt-3 max-w-[40ch] text-base leading-relaxed text-muted">{PRIVACY.lede}</p>
          <p className="mt-10 flex flex-wrap gap-x-6 gap-y-2">
            <Link
              href="/security"
              className="text-sm font-medium text-muted underline-offset-4 transition-colors duration-150 hover:text-ink hover:underline"
            >
              Security
            </Link>
            <Link
              href="/privacy"
              className="text-sm font-medium text-muted underline-offset-4 transition-colors duration-150 hover:text-ink hover:underline"
            >
              Privacy
            </Link>
          </p>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto max-w-[40rem] px-5 py-20 sm:px-8 sm:py-24">
          <h2 className="text-[length:var(--rb-text-title)] font-semibold tracking-[-0.02em] text-ink">
            {CLOSE.headline}
          </h2>
          <p className="mt-3 max-w-[36ch] text-base leading-relaxed text-muted">{CLOSE.lede}</p>
          <div className="mt-8 max-w-xs">
            <Button asChild variant="action" size="lg">
              <Link href={START_HREF}>Get started</Link>
            </Button>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
