import Image from "next/image";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CustomerPageShowcase } from "@/features/public/customer-page-showcase";
import { DashboardPreviewSection } from "@/features/public/dashboard-preview-section";
import { FAQ } from "@/features/public/faq";
import { PricingTable } from "@/features/public/pricing-table";
import {
  CLOSE,
  HOW_IT_WORKS,
  INTEGRITY,
  PRICING,
  PRIVACY,
  PUBLIC_HERO,
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
      <section className="bg-quiet">
        <div className="mx-auto flex max-w-[1200px] flex-col-reverse items-center gap-10 px-5 py-20 sm:px-8 md:flex-row md:gap-12 md:py-28">
          <div className="flex w-full flex-col md:w-1/2">
            <span className="inline-flex w-fit items-center gap-2 rounded-full bg-brand-soft px-3 py-1.5 text-xs font-semibold text-ink">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              Every star gets the same Google link
            </span>
            <h1 className="mt-6 text-[clamp(2.5rem,5.5vw,4.25rem)] font-extrabold leading-[1.05] tracking-[-0.035em] text-ink">
              {PUBLIC_HERO.title}
            </h1>
            <p className="mt-6 max-w-[40ch] text-xl leading-relaxed text-muted">
              {PUBLIC_HERO.lede}
            </p>
            <div className="mt-9 flex max-w-sm flex-col gap-3 sm:flex-row">
              <Button asChild variant="action" size="lg" className="rounded-full">
                <Link href={PUBLIC_HERO.primary.href}>{PUBLIC_HERO.primary.label}</Link>
              </Button>
              <Button asChild variant="ghost" size="lg" className="rounded-full text-ink hover:bg-brand-soft">
                <Link href={PUBLIC_HERO.secondary.href}>{PUBLIC_HERO.secondary.label}</Link>
              </Button>
            </div>
          </div>
          <div className="w-full overflow-hidden rounded-[2rem] md:w-1/2">
            <Image
              src="/images/hero-counter-tag.png"
              alt="A customer holding a phone up to a Tag on a shop counter"
              width={960}
              height={720}
              className="h-full w-full object-cover"
              priority
            />
          </div>
        </div>
      </section>

      <CustomerPageShowcase />

      <section className="border-t border-border bg-canvas">
        <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-28">
          <Reveal>
            <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-brand-text">
              How it works
            </p>
          </Reveal>
          <ol className="mt-10 grid gap-8 md:grid-cols-3 md:gap-6">
            {HOW_IT_WORKS.map((step, index) => (
              <Reveal key={step.title} delay={index * 90} className="h-full">
                <li className="flex h-full flex-col gap-4 rounded-2xl border border-border bg-white p-6">
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-ink">
                    {index + 1}
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink">
                      {step.title}
                    </h2>
                    <p className="mt-2 text-base leading-relaxed text-muted">{step.body}</p>
                  </div>
                </li>
              </Reveal>
            ))}
          </ol>
          <p className="mt-10">
            <Link
              href="/how-it-works"
              className="text-sm font-medium text-brand-text underline-offset-4 transition-colors duration-150 hover:underline"
            >
              The whole path
            </Link>
          </p>
        </div>
      </section>

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
