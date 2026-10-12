import Link from "next/link";

import { Button } from "@/components/ui/button";
import { FAQ } from "@/features/public/faq";
import { PricingSection } from "@/features/public/pricing-table";
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
import { ProductDemo } from "@/features/public/product-demo";
import { PublicShell } from "@/features/public/public-shell";

/**
 * Signed-out homepage. One idea per band. No testimonials, no invented counts.
 */
export function PublicHome() {
  return (
    <PublicShell>
      <section className="public-section public-hero">
        <div>
          <p className="mb-4 text-sm font-medium text-muted">
            For local business owners
          </p>
          <h1 className="max-w-[17ch] text-[2.25rem] font-semibold leading-[1.12] tracking-[-0.035em] text-ink sm:text-[3.25rem]">
            {PUBLIC_HERO.title}
          </h1>
          <p className="mt-5 max-w-[42ch] text-lg leading-relaxed text-muted">
            {PUBLIC_HERO.lede}
          </p>
          <div className="mt-8 flex max-w-sm gap-2">
            <Button asChild variant="action" size="lg">
              <Link href={PUBLIC_HERO.primary.href}>
                {PUBLIC_HERO.primary.label}
              </Link>
            </Button>
            <Button asChild variant="ghost" size="lg">
              <Link href={PUBLIC_HERO.secondary.href}>
                {PUBLIC_HERO.secondary.label}
              </Link>
            </Button>
          </div>
          <a
            href="#customer-example"
            className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-brand-text underline underline-offset-4"
          >
            Try the customer example
          </a>
          <p className="mt-2 text-sm text-muted">
            Print a code or use a blank NFC tag. Your customer needs only their
            phone.
          </p>
        </div>
        <ProductDemo />
      </section>

      <section className="border-t border-border">
        <div className="public-section" id="how-it-works">
          <h2 className="text-2xl font-semibold tracking-tight text-ink">
            From the counter to your Feedback.
          </h2>
          <ol className="public-steps mt-10">
            {HOW_IT_WORKS.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span className="w-6 shrink-0 text-sm font-semibold text-muted">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h2 className="text-[length:var(--rb-text-title)] font-semibold tracking-[-0.02em] text-ink">
                    {step.title}
                  </h2>
                  <p className="mt-2 max-w-[36ch] text-base leading-relaxed text-muted">
                    {step.body}
                  </p>
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
        <div className="public-section public-owner-jobs">
          <div>
            <p className="text-sm font-medium text-muted">
              Your side of the counter
            </p>
            <h2 className="mt-4 max-w-[20ch] text-3xl font-semibold leading-tight tracking-tight text-ink">
              Know what needs you. Get back to your day.
            </h2>
            <p className="mt-4 max-w-[40ch] text-base leading-relaxed text-muted">
              Open Home between customers. See new ratings, read Feedback, and
              keep your Tags ready.
            </p>
            <Link
              href="/product"
              className="mt-5 inline-flex min-h-11 items-center text-sm font-medium text-brand-text underline-offset-4 hover:underline"
            >
              See the product
            </Link>
          </div>
          <ol className="divide-y divide-border border-y border-border">
            <li className="py-5">
              <h3 className="font-semibold text-ink">Make the page yours</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Add your business photo. Preview the same page customers see,
                then publish.
              </p>
            </li>
            <li className="py-5">
              <h3 className="font-semibold text-ink">
                Keep every rating together
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Home shows what is new. Feedback keeps the full picture,
                including the low ratings.
              </p>
            </li>
            <li className="py-5">
              <h3 className="font-semibold text-ink">Ask after a visit</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Text Requests sends the same Tag link to customers who agreed to
                receive it.
              </p>
            </li>
          </ol>
        </div>
      </section>

      <section className="border-t border-border bg-quiet">
        <div className="mx-auto max-w-[40rem] px-5 py-12 sm:px-8 sm:py-16">
          <p className="text-sm font-medium text-muted">Integrity</p>
          <h2 className="mt-4 text-[length:var(--rb-text-title)] font-semibold tracking-[-0.02em] text-ink">
            {INTEGRITY.headline}
          </h2>
          <p className="mt-4 max-w-[40ch] text-base leading-relaxed text-muted">
            {INTEGRITY.lede}
          </p>
          <p className="mt-3 max-w-[40ch] text-base leading-relaxed text-muted">
            {INTEGRITY.body}
          </p>
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

      {/* The prices themselves, as a full-width dark band. This section used
          to be a headline, a lede and a link — a pricing section with no
          prices in it, which is the one question a visitor came to answer. */}
      <PricingSection headline={PRICING.headline} lede={PRICING.lede}>
        {/* The trial terms are already on the Starter card and in the line
            under the cards; a third telling here was repetition. */}
        <p className="mt-12 text-center text-sm">
          <Link
            href="/pricing"
            className="font-medium text-ink underline-offset-4 transition-colors duration-150 hover:underline"
          >
            How we charge
          </Link>
        </p>
      </PricingSection>

      <section className="border-t border-border">
        <div className="mx-auto max-w-[40rem] px-5 py-12 sm:px-8 sm:py-16">
          <p className="text-sm font-medium text-muted">Security and privacy</p>
          <h2 className="mt-4 text-[length:var(--rb-text-title)] font-semibold tracking-[-0.02em] text-ink">
            {SECURITY.headline}
          </h2>
          <p className="mt-3 max-w-[40ch] text-base leading-relaxed text-muted">
            {SECURITY.lede}
          </p>
          <p className="mt-3 max-w-[40ch] text-base leading-relaxed text-muted">
            {PRIVACY.lede}
          </p>
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
        <div className="mx-auto max-w-[40rem] px-5 py-12 sm:px-8 sm:py-16">
          <p className="text-sm font-medium text-muted">Questions</p>
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
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto max-w-[40rem] px-5 py-12 sm:px-8 sm:py-16">
          <h2 className="text-[length:var(--rb-text-title)] font-semibold tracking-[-0.02em] text-ink">
            {CLOSE.headline}
          </h2>
          <p className="mt-3 max-w-[36ch] text-base leading-relaxed text-muted">
            {CLOSE.lede}
          </p>
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
