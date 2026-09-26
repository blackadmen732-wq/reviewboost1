import Link from "next/link";

import { Button } from "@/components/ui/button";
import { CustomerPageShowcase } from "@/features/public/customer-page-showcase";
import { DashboardPreviewSection } from "@/features/public/dashboard-preview-section";
import { FAQ } from "@/features/public/faq";
import { Hero } from "@/features/public/hero";
import { HowItWorksScenes } from "@/features/public/how-it-works-scenes";
import { PricingSection } from "@/features/public/pricing-table";
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
 * The bands deliberately do not share one template. In order:
 *
 *   Hero            split — copy beside the product scene
 *   Customer page   centred — one large carousel
 *   How it works    a sequence of three different scenes
 *   Tag / NFC       the physical objects, on a counter
 *   Owner Home      editorial split with the real Home UI
 *   Text Requests   the reverse split — phone first
 *   Pricing         full-width dark band
 *   Integrity       quiet, typographic
 *   Questions       plain two-column list
 *   Close           dark finish, with the Tag
 *
 * Motion is `<Reveal>` only: a band rises into place once. Nothing loops.
 */

const linkClass =
  "text-sm font-semibold text-brand-text underline-offset-4 transition-colors duration-150 hover:underline";

export function PublicHome() {
  return (
    <PublicShell>
      <Hero />

      <CustomerPageShowcase />

      <HowItWorksScenes />

      <section className="border-b border-border bg-surface">
        <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-28">
          <Reveal>
            <TagTapSection />
          </Reveal>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-28">
          <Reveal className="grid items-center gap-12 md:grid-cols-12 md:gap-12">
            <div className="md:col-span-5">
              <p className="text-sm font-semibold text-brand-text">Your Home screen</p>
              <h2 className="mt-4 text-[clamp(1.9rem,3.4vw,2.75rem)] font-bold leading-[1.08] tracking-[-0.03em] text-ink">
                One screen, and it tells you what actually needs you.
              </h2>
              <p className="mt-5 max-w-[38ch] text-lg leading-relaxed text-muted">
                Setup is four short things, not a wizard. Once they&apos;re done, this screen gets
                out of the way and shows the feedback that just came in.
              </p>
            </div>
            <div className="md:col-span-7">
              <DashboardPreviewSection />
            </div>
          </Reveal>
        </div>
      </section>

      <section className="border-b border-border bg-surface">
        <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-28">
          <Reveal>
            <TextRequestSection />
          </Reveal>
        </div>
      </section>

      <PricingSection headline={PRICING.headline} lede={PRICING.lede}>
        <p className="mt-12 text-center">
          <Link href="/pricing" className={linkClass}>
            How we charge
          </Link>
        </p>
      </PricingSection>

      {/* Integrity: typography only. The promise is the design. */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-[1200px] px-5 py-24 sm:px-8 sm:py-32">
          <Reveal>
            <h2 className="max-w-[20ch] text-[clamp(2.25rem,5vw,4.25rem)] font-bold leading-[1.02] tracking-[-0.04em] text-ink">
              {INTEGRITY.headline}
            </h2>
            <div className="mt-12 grid gap-10 border-t border-border pt-10 md:grid-cols-3">
              <div className="md:col-span-2">
                <p className="max-w-[46ch] text-xl leading-relaxed text-ink">{INTEGRITY.lede}</p>
                <p className="mt-4 max-w-[52ch] text-base leading-relaxed text-muted">
                  {INTEGRITY.body}
                </p>
                <p className="mt-6">
                  <Link href="/integrity" className={linkClass}>
                    Why this is the product
                  </Link>
                </p>
              </div>
              <div>
                <p className="text-base font-semibold text-ink">{SECURITY.headline}</p>
                <p className="mt-2 text-base leading-relaxed text-muted">{SECURITY.lede}</p>
                <p className="mt-2 text-base leading-relaxed text-muted">{PRIVACY.lede}</p>
                <p className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
                  <Link href="/security" className={linkClass}>
                    Security
                  </Link>
                  <Link href="/privacy" className={linkClass}>
                    Privacy
                  </Link>
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section>
        <div className="mx-auto grid max-w-[1200px] gap-10 px-5 py-20 sm:px-8 sm:py-28 md:grid-cols-12">
          <div className="md:col-span-4">
            <h2 className="text-[clamp(1.9rem,3.4vw,2.75rem)] font-bold leading-[1.08] tracking-[-0.03em] text-ink">
              Questions
            </h2>
            <p className="mt-4 max-w-[28ch] text-base leading-relaxed text-muted">
              Something else?{" "}
              <Link href="/support" className={linkClass}>
                Ask us
              </Link>
              .
            </p>
          </div>
          {/* Plain <details>. It is keyboard accessible and works before any
              JavaScript arrives, which matters on a phone with two bars. */}
          <div className="divide-y divide-border border-y border-border md:col-span-8">
            {FAQ.map((entry) => (
              <details key={entry.question} className="group py-5">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-ink [&::-webkit-details-marker]:hidden">
                  {entry.question}
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-xl text-muted transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-2 max-w-[60ch] text-base leading-relaxed text-muted">
                  {entry.answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* The close: a dark band, the promise, one action. */}
      <section className="rb-public-dark bg-canvas text-ink">
        <Reveal className="mx-auto flex max-w-[1200px] flex-col items-center px-5 py-24 text-center sm:px-8 sm:py-32">
          <h2 className="max-w-[16ch] text-[clamp(2.6rem,6vw,5rem)] font-bold leading-[1] tracking-[-0.045em] text-ink">
            {CLOSE.headline}
          </h2>
          <p className="mt-6 max-w-[44ch] text-lg leading-relaxed text-muted sm:text-xl">{CLOSE.lede}</p>
          <div className="mt-10 flex w-full max-w-sm flex-col items-center gap-4">
            <Button asChild variant="action" size="lg" className="rounded-full sm:w-auto sm:px-12">
              <Link href={START_HREF}>Get started</Link>
            </Button>
            <p className="text-sm text-muted">
              Starter comes with seven days free. Already set up?{" "}
              <Link href="/login" className={linkClass}>
                Sign in
              </Link>
            </p>
          </div>
        </Reveal>
      </section>
    </PublicShell>
  );
}
