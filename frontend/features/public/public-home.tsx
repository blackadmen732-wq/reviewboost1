import Image from "next/image";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FAQ } from "@/features/public/faq";
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
 *
 * Hero and section framing follow the Figma "hero-section" / "features-section"
 * layout direction (two-column hero, dark-green display type, rounded pill
 * accents) — with the real product copy, not the reference's placeholder
 * "Trusted by 50,000+ businesses" stat, which this product would never invent.
 */
export function PublicHome() {
  return (
    <PublicShell>
      <section className="bg-[#edede5]">
        <div className="mx-auto flex max-w-[1200px] flex-col-reverse items-center gap-10 px-5 py-16 sm:px-8 md:flex-row md:gap-12 md:py-24">
          <div className="flex w-full flex-col md:w-1/2">
            <span className="inline-flex w-fit items-center gap-2 rounded-full bg-[#d8f3dc] px-3 py-1.5 text-xs font-semibold text-[#1b4332]">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              Every star gets the same Google link
            </span>
            <h1 className="mt-6 text-[2.25rem] font-extrabold leading-[1.12] tracking-[-0.03em] text-[#1b4332] sm:text-[2.75rem]">
              {PUBLIC_HERO.title}
            </h1>
            <p className="mt-5 max-w-[40ch] text-lg leading-relaxed text-[#4a5d4e]">
              {PUBLIC_HERO.lede}
            </p>
            <div className="mt-9 flex max-w-sm flex-col gap-3 sm:flex-row">
              <Button asChild variant="action" size="lg" className="rounded-full">
                <Link href={PUBLIC_HERO.primary.href}>{PUBLIC_HERO.primary.label}</Link>
              </Button>
              <Button asChild variant="ghost" size="lg" className="rounded-full text-[#1b4332] hover:bg-[#d8f3dc]">
                <Link href={PUBLIC_HERO.secondary.href}>{PUBLIC_HERO.secondary.label}</Link>
              </Button>
            </div>
          </div>
          <div className="w-full overflow-hidden rounded-3xl md:w-1/2">
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

      <section className="border-t border-[#e1e5dc] bg-[#f5f6f0]">
        <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-24">
          <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-[#2d6a4f]">
            How it works
          </p>
          <ol className="mt-10 grid gap-8 md:grid-cols-3 md:gap-6">
            {HOW_IT_WORKS.map((step, index) => (
              <li
                key={step.title}
                className="flex flex-col gap-4 rounded-2xl border border-[#e1e5dc] bg-white p-6"
              >
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[#d8f3dc] text-sm font-bold text-[#1b4332]">
                  {index + 1}
                </span>
                <div>
                  <h2 className="text-lg font-semibold tracking-[-0.01em] text-[#1b4332]">
                    {step.title}
                  </h2>
                  <p className="mt-2 text-base leading-relaxed text-[#4a5d4e]">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-10">
            <Link
              href="/how-it-works"
              className="text-sm font-medium text-[#2d6a4f] underline-offset-4 transition-colors duration-150 hover:underline"
            >
              The whole path
            </Link>
          </p>
        </div>
      </section>

      <section className="border-t border-[#e1e5dc] bg-[#f5f6f0]">
        <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-24">
          <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-[#2d6a4f]">
            Product
          </p>
          <h2 className="mt-4 text-2xl font-bold tracking-[-0.02em] text-[#1b4332]">
            {PRODUCT.headline}
          </h2>
          <p className="mt-3 max-w-[40ch] text-base leading-relaxed text-[#4a5d4e]">{PRODUCT.lede}</p>
          <ul className="mt-10 grid gap-6 sm:grid-cols-2">
            {PRODUCT.items.map((item) => (
              <li key={item.title} className="rounded-2xl border border-[#e1e5dc] bg-white p-6">
                <h3 className="text-base font-semibold text-[#1b4332]">{item.title}</h3>
                <p className="mt-2 text-base leading-relaxed text-[#4a5d4e]">{item.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-10">
            <Link
              href="/product"
              className="text-sm font-medium text-[#2d6a4f] underline-offset-4 transition-colors duration-150 hover:underline"
            >
              Tags in full
            </Link>
          </p>
        </div>
      </section>

      <section className="border-t border-[#e1e5dc] bg-white">
        <div className="mx-auto max-w-[40rem] px-5 py-20 sm:px-8 sm:py-24">
          <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-[#2d6a4f]">
            Integrity
          </p>
          <h2 className="mt-4 text-2xl font-bold tracking-[-0.02em] text-[#1b4332]">
            {INTEGRITY.headline}
          </h2>
          <p className="mt-4 max-w-[40ch] text-base leading-relaxed text-[#4a5d4e]">{INTEGRITY.lede}</p>
          <p className="mt-3 max-w-[40ch] text-base leading-relaxed text-[#4a5d4e]">{INTEGRITY.body}</p>
          <p className="mt-10">
            <Link
              href="/integrity"
              className="text-sm font-medium text-[#2d6a4f] underline-offset-4 transition-colors duration-150 hover:underline"
            >
              Why this is the product
            </Link>
          </p>
        </div>
      </section>

      <section className="border-t border-[#e1e5dc] bg-[#f5f6f0]">
        <div className="mx-auto max-w-[40rem] px-5 py-20 sm:px-8 sm:py-24">
          <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-[#2d6a4f]">
            Pricing
          </p>
          <h2 className="mt-4 text-2xl font-bold tracking-[-0.02em] text-[#1b4332]">
            {PRICING.headline}
          </h2>
          <p className="mt-3 max-w-[36ch] text-base leading-relaxed text-[#4a5d4e]">{PRICING.lede}</p>

          {/* The prices themselves. This section used to be a headline, a lede
              and a link — a pricing section with no prices in it, which is the
              one question a visitor came to answer. */}
          <div className="mt-10">
            <PricingTable />
          </div>

          <p className="mt-6 max-w-[48ch] text-sm leading-relaxed text-[#4a5d4e]">{PRICING.caveat}</p>
          <p className="mt-10">
            <Link
              href="/pricing"
              className="text-sm font-medium text-[#2d6a4f] underline-offset-4 transition-colors duration-150 hover:underline"
            >
              How we charge
            </Link>
          </p>
        </div>
      </section>

      <section className="border-t border-[#e1e5dc] bg-white">
        <div className="mx-auto max-w-[40rem] px-5 py-20 sm:px-8 sm:py-24">
          <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-[#2d6a4f]">
            Security and privacy
          </p>
          <h2 className="mt-4 text-2xl font-bold tracking-[-0.02em] text-[#1b4332]">
            {SECURITY.headline}
          </h2>
          <p className="mt-3 max-w-[40ch] text-base leading-relaxed text-[#4a5d4e]">{SECURITY.lede}</p>
          <p className="mt-3 max-w-[40ch] text-base leading-relaxed text-[#4a5d4e]">{PRIVACY.lede}</p>
          <p className="mt-10 flex flex-wrap gap-x-6 gap-y-2">
            <Link
              href="/security"
              className="text-sm font-medium text-[#2d6a4f] underline-offset-4 transition-colors duration-150 hover:underline"
            >
              Security
            </Link>
            <Link
              href="/privacy"
              className="text-sm font-medium text-[#2d6a4f] underline-offset-4 transition-colors duration-150 hover:underline"
            >
              Privacy
            </Link>
          </p>
        </div>
      </section>

      <section className="border-t border-[#e1e5dc] bg-[#f5f6f0]">
        <div className="mx-auto max-w-[40rem] px-5 py-20 sm:px-8 sm:py-24">
          <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-[#2d6a4f]">
            Questions
          </p>
          {/* Plain <details>. It is keyboard accessible and works before any
              JavaScript arrives, which matters on a phone with two bars. */}
          <div className="mt-8 divide-y divide-[#e1e5dc] border-y border-[#e1e5dc]">
            {FAQ.map((entry) => (
              <details key={entry.question} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium text-[#1b2a1e] [&::-webkit-details-marker]:hidden">
                  {entry.question}
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-[#4a5d4e] transition-transform duration-150 group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 max-w-[52ch] text-base leading-relaxed text-[#4a5d4e]">
                  {entry.answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[#e1e5dc] bg-[#edede5]">
        <div className="mx-auto max-w-[40rem] px-5 py-20 sm:px-8 sm:py-24">
          <h2 className="text-2xl font-bold tracking-[-0.02em] text-[#1b4332]">{CLOSE.headline}</h2>
          <p className="mt-3 max-w-[36ch] text-base leading-relaxed text-[#4a5d4e]">{CLOSE.lede}</p>
          <div className="mt-8 max-w-xs">
            <Button asChild variant="action" size="lg" className="rounded-full">
              <Link href={START_HREF}>Get started</Link>
            </Button>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
