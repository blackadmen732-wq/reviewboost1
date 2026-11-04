import Link from "next/link";
import { ArrowDown, ArrowUpRight, BellRing, ChartLine, Check, MessageSquareText, QrCode, Star, Users, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FAQ } from "@/features/public/faq";
import { OwnerPreview } from "@/features/public/owner-preview";
import { PricingSection } from "@/features/public/pricing-table";
import {
  CLOSE,
  COMPARE,
  HOW_IT_WORKS,
  INTEGRITY,
  OWNER_SIDE,
  PRICING,
  PUBLIC_HERO,
  SECURITY,
  SIGN_IN_HREF,
  START_HREF,
} from "@/features/public/public-copy";
import { ProductDemo } from "@/features/public/product-demo";
import { PublicShell } from "@/features/public/public-shell";
import { cn } from "@/lib/utils/cn";

/**
 * Signed-out homepage, for a busy owner deciding in seconds: who it is for,
 * what it does, how it works, what they see, why it beats a plain card, what
 * it costs. One idea per band. No testimonials, no invented counts: the one
 * screen with numbers on it is labelled as an example.
 */
const STEP_ICONS = [QrCode, Star, ArrowUpRight] as const;
// By name, not position: which items show depends on the texting switch.
const OWNER_ICONS: Record<(typeof OWNER_SIDE.items)[number]["icon"], LucideIcon> = {
  new: BellRing,
  team: Users,
  texts: MessageSquareText,
  insights: ChartLine,
};

export function PublicHome() {
  return (
    <PublicShell homepage currentPath="/">
      <section className="public-section public-hero">
        <div className="public-hero__copy">
          <p className="public-hero__eyebrow">{PUBLIC_HERO.eyebrow}</p>
          <h1 className="public-hero__title">
            <span>{PUBLIC_HERO.titleLines[0]}</span>{" "}
            <span>{PUBLIC_HERO.titleLines[1]}</span>
          </h1>
          <p className="public-hero__lede">{PUBLIC_HERO.lede}</p>
          <div className="public-hero__actions">
            <Button asChild variant="action" className="w-auto">
              <Link href={PUBLIC_HERO.primary.href}>{PUBLIC_HERO.primary.label}</Link>
            </Button>
            <a href="#customer-example" className="public-hero__sample-link">
              Try the example <ArrowDown className="size-4" aria-hidden="true" />
            </a>
          </div>
          {/* On a phone the header has room for one button, and Sign in sat
              behind the menu; a returning owner hunted for it among
              "Get started" buttons. From 640px up it is in the header. */}
          <p className="mt-3 text-sm text-muted sm:hidden">
            Already have an account?{" "}
            <Link
              href={SIGN_IN_HREF}
              className="inline-flex min-h-11 items-center font-medium text-ink underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
            >
              Sign in
            </Link>
          </p>
          <ul className="public-hero__facts" aria-label="At a glance">
            {PUBLIC_HERO.facts.map((fact) => (
              <li key={fact}>
                <Check aria-hidden="true" className="size-4 shrink-0 text-brand-text" strokeWidth={2.5} />
                {fact}
              </li>
            ))}
          </ul>
        </div>
        <ProductDemo hero />
      </section>

      <section className="border-t border-border">
        <div className="public-section" id="how-it-works">
          <p className="public-eyebrow">How it works</p>
          <h2 className="public-h2">Three steps. No app for your customers.</h2>
          <ol className="public-steps mt-10">
            {HOW_IT_WORKS.map((step, index) => {
              const Icon = STEP_ICONS[index]!;
              return (
                <li key={step.title} className="public-step">
                  <span className="public-step__icon" aria-hidden="true">
                    <Icon className="size-6" strokeWidth={1.9} />
                  </span>
                  <p className="public-step__number">Step {index + 1}</p>
                  <h3 className="public-step__title">{step.title}</h3>
                  <p className="public-step__body">{step.body}</p>
                </li>
              );
            })}
          </ol>
          <p className="mt-8">
            <Link href="/how-it-works" className="public-quiet-link">
              The whole path, step by step
            </Link>
          </p>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="public-section public-owner">
          <div>
            <p className="public-eyebrow">{OWNER_SIDE.eyebrow}</p>
            <h2 className="public-h2">{OWNER_SIDE.headline}</h2>
            <p className="public-lede">{OWNER_SIDE.lede}</p>
            <ul className="mt-8 flex flex-col gap-6">
              {OWNER_SIDE.items.map((item) => {
                const Icon = OWNER_ICONS[item.icon];
                return (
                  <li key={item.title} className="flex gap-4">
                    <span className="public-step__icon public-step__icon--soft" aria-hidden="true">
                      <Icon className="size-5" strokeWidth={1.9} />
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold text-ink">{item.title}</h3>
                      <p className="mt-1 max-w-[42ch] text-base leading-relaxed text-muted">{item.body}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-8">
              <Link href="/product" className="public-quiet-link">
                See the product
              </Link>
            </p>
          </div>
          <OwnerPreview />
        </div>
      </section>

      <section className="border-t border-border">
        <div className="public-section">
          <p className="public-eyebrow">Compared</p>
          <h2 className="public-h2">{COMPARE.headline}</h2>
          <p className="public-lede">{COMPARE.lede}</p>
          <ul className="public-compare mt-10">
            {COMPARE.options.map((option) => (
              <li key={option.name} className={cn("public-compare__card", option.ours && "public-compare__card--ours")}>
                <h3 className="text-lg font-semibold text-ink">{option.name}</h3>
                <p className="mt-1 text-base font-medium text-muted">{option.price}</p>
                <p className="mt-4 text-base leading-relaxed text-ink">{option.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-t border-border bg-quiet">
        <div className="mx-auto max-w-[44rem] px-5 py-14 sm:px-8 sm:py-20">
          <p className="public-eyebrow">Integrity</p>
          <h2 className="public-h2">{INTEGRITY.headline}</h2>
          <p className="public-lede">{INTEGRITY.lede}</p>
          <p className="mt-6 flex max-w-[46ch] gap-3 text-base font-medium leading-relaxed text-ink">
            <Check aria-hidden="true" className="mt-1 size-5 shrink-0 text-brand-text" strokeWidth={2.5} />
            {INTEGRITY.rule}
          </p>
          <p className="mt-6">
            <Link href="/integrity" className="public-quiet-link">
              Why this is the product
            </Link>
          </p>
        </div>
      </section>

      {/* The prices themselves, as a full-width band: the one question a
          visitor came to answer. */}
      <PricingSection headline={PRICING.headline} lede={PRICING.lede}>
        <p className="mt-12 text-center text-sm">
          <Link href="/pricing" className="font-medium text-ink underline-offset-4 transition-colors duration-150 hover:underline">
            How we charge
          </Link>
        </p>
      </PricingSection>

      <section className="border-t border-border">
        <div className="mx-auto max-w-[44rem] px-5 py-14 sm:px-8 sm:py-20">
          <p className="public-eyebrow">Security and privacy</p>
          <h2 className="public-h2">{SECURITY.headline}</h2>
          <p className="public-lede">{SECURITY.lede}</p>
          <p className="mt-6 flex flex-wrap gap-x-6">
            <Link href="/security" className="public-quiet-link">
              Security
            </Link>
            <Link href="/privacy" className="public-quiet-link">
              Privacy
            </Link>
          </p>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto max-w-[44rem] px-5 py-14 sm:px-8 sm:py-20">
          <p className="public-eyebrow">Questions</p>
          <h2 className="public-h2">What owners ask first</h2>
          {/* Plain <details>. It is keyboard accessible and works before any
              JavaScript arrives, which matters on a phone with two bars. */}
          <div className="mt-8 divide-y divide-border border-y border-border">
            {FAQ.map((entry) => (
              <details key={entry.question} className="group py-4">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-lg font-medium text-ink [&::-webkit-details-marker]:hidden">
                  {entry.question}
                  <span aria-hidden="true" className="shrink-0 text-xl text-muted transition-transform duration-150 group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 max-w-[56ch] text-base leading-relaxed text-muted">{entry.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto max-w-[44rem] px-5 py-14 text-center sm:px-8 sm:py-20">
          <h2 className="public-h2">{CLOSE.headline}</h2>
          <p className="public-lede mx-auto">{CLOSE.lede}</p>
          <div className="mx-auto mt-8 max-w-xs">
            <Button asChild variant="action" size="lg">
              <Link href={START_HREF}>{PUBLIC_HERO.primary.label}</Link>
            </Button>
          </div>
          <p className="mx-auto mt-4 max-w-[40ch] text-sm leading-relaxed text-muted">{CLOSE.note}</p>
        </div>
      </section>
    </PublicShell>
  );
}
