import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Hero } from "@/features/public/hero";
import { HowItWorksScenes } from "@/features/public/how-it-works-scenes";
import { CustomerPageShowcase } from "@/features/public/customer-page-showcase";
import { DashboardPreviewSection } from "@/features/public/dashboard-preview-section";
import { FAQ } from "@/features/public/faq";
import { PricingTable } from "@/features/public/pricing-table";
import {
  CLOSE,
  INTEGRITY,
  PRICING,
  PRIVACY,
  SECURITY,
  START_HREF,
} from "@/features/public/public-copy";
import { PublicShell } from "@/features/public/public-shell";
import { Reveal } from "@/features/public/reveal";
import { TagTapSection } from "@/features/public/tag-tap-section";
import { TextRequestSection } from "@/features/public/text-request-section";

/**
 * Signed-out homepage. One idea per band. No testimonials, no invented counts.
 *
 * Hero and section framing follow the Figma "hero-section" / "features-section"
 * layout direction (two-column hero, dark-green display type, rounded pill
 * accents) — with the real product copy, not the reference's placeholder
 * "Trusted by 50,000+ businesses" stat, which this product would never invent.
 *
 * The one motion idea on the page is `<Reveal>` (a section rises and fades in
 * once, on scroll) plus the single looping glyph in `TagTapSection` — kept
 * to those two spots deliberately, so scrolling the page never turns into a
 * slot machine of things animating at once.
 */
export function PublicHome() {
  return (
    <PublicShell>
      <Hero />

      <CustomerPageShowcase />

      <HowItWorksScenes />

      <section className="border-t border-border bg-white">
        <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-28">
          <Reveal>
            <TagTapSection />
          </Reveal>
        </div>
      </section>

      <section className="border-t border-border bg-canvas">
        <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-28">
          <Reveal className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-brand-text">Home</p>
              <h2 className="mt-4 text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.1] tracking-[-0.02em] text-ink">
                One screen, and it tells you what actually needs you
              </h2>
              <p className="mt-4 max-w-[38ch] text-lg leading-relaxed text-muted">
                Setup is four short things, not a wizard. Once they&apos;re done, this
                screen gets out of the way and shows the feedback that just came in.
              </p>
            </div>
            <DashboardPreviewSection />
          </Reveal>
        </div>
      </section>

      <section className="border-t border-border bg-white">
        <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-28">
          <Reveal>
            <TextRequestSection />
          </Reveal>
        </div>
      </section>

      <section className="border-t border-border bg-canvas">
        <div className="mx-auto max-w-[40rem] px-5 py-20 sm:px-8 sm:py-28">
          <Reveal>
            <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-brand-text">
              Integrity
            </p>
            <h2 className="mt-4 text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.1] tracking-[-0.02em] text-ink">
              {INTEGRITY.headline}
            </h2>
            <p className="mt-4 max-w-[40ch] text-lg leading-relaxed text-muted">{INTEGRITY.lede}</p>
            <p className="mt-3 max-w-[40ch] text-base leading-relaxed text-muted">{INTEGRITY.body}</p>
            <p className="mt-10">
              <Link
                href="/integrity"
                className="text-sm font-medium text-brand-text underline-offset-4 transition-colors duration-150 hover:underline"
              >
                Why this is the product
              </Link>
            </p>
          </Reveal>
        </div>
      </section>

      <section className="border-t border-border bg-white">
        <div className="mx-auto max-w-[52rem] px-5 py-20 sm:px-8 sm:py-28">
          <Reveal>
            <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-brand-text">
              Pricing
            </p>
            <h2 className="mt-4 text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.1] tracking-[-0.02em] text-ink">
              {PRICING.headline}
            </h2>
            <p className="mt-3 max-w-[36ch] text-lg leading-relaxed text-muted">{PRICING.lede}</p>

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
                className="text-sm font-medium text-brand-text underline-offset-4 transition-colors duration-150 hover:underline"
              >
                How we charge
              </Link>
            </p>
          </Reveal>
        </div>
      </section>

      <section className="border-t border-border bg-canvas">
        <div className="mx-auto max-w-[40rem] px-5 py-20 sm:px-8 sm:py-28">
          <Reveal>
            <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-brand-text">
              Security and privacy
            </p>
            <h2 className="mt-4 text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.1] tracking-[-0.02em] text-ink">
              {SECURITY.headline}
            </h2>
            <p className="mt-3 max-w-[40ch] text-lg leading-relaxed text-muted">{SECURITY.lede}</p>
            <p className="mt-3 max-w-[40ch] text-base leading-relaxed text-muted">{PRIVACY.lede}</p>
            <p className="mt-10 flex flex-wrap gap-x-6 gap-y-2">
              <Link
                href="/security"
                className="text-sm font-medium text-brand-text underline-offset-4 transition-colors duration-150 hover:underline"
              >
                Security
              </Link>
              <Link
                href="/privacy"
                className="text-sm font-medium text-brand-text underline-offset-4 transition-colors duration-150 hover:underline"
              >
                Privacy
              </Link>
            </p>
          </Reveal>
        </div>
      </section>

      <section className="border-t border-border bg-white">
        <div className="mx-auto max-w-[40rem] px-5 py-20 sm:px-8 sm:py-28">
          <Reveal>
            <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-brand-text">
              Questions
            </p>
            {/* Plain <details>. It is keyboard accessible and works before any
                JavaScript arrives, which matters on a phone with two bars. */}
            <div className="mt-8 divide-y divide-border border-y border-border">
              {FAQ.map((entry) => (
                <details key={entry.question} className="group py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium text-ink [&::-webkit-details-marker]:hidden">
                    {entry.question}
                    <span
                      aria-hidden="true"
                      className="shrink-0 text-muted transition-transform duration-150 group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-3 max-w-[52ch] text-base leading-relaxed text-muted">
                    {entry.answer}
                  </p>
                </details>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="border-t border-border bg-quiet">
        <div className="mx-auto max-w-[40rem] px-5 py-20 sm:px-8 sm:py-28">
          <Reveal>
            <h2 className="text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.1] tracking-[-0.02em] text-ink">
              {CLOSE.headline}
            </h2>
            <p className="mt-3 max-w-[36ch] text-lg leading-relaxed text-muted">{CLOSE.lede}</p>
            <div className="mt-8 max-w-xs">
              <Button asChild variant="action" size="lg" className="rounded-full">
                <Link href={START_HREF}>Get started</Link>
              </Button>
            </div>
          </Reveal>
        </div>
      </section>
    </PublicShell>
  );
}
