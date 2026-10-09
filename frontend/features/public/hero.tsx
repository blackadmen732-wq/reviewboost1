import Image from "next/image";
import Link from "next/link";
import { Nfc, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DashboardPreviewSection } from "@/features/public/dashboard-preview-section";
import { DemoPhone } from "@/features/public/demo-phone";
import { PUBLIC_HERO } from "@/features/public/public-copy";
import { ScaleToFit } from "@/features/public/scale-to-fit";
import { TagObject } from "@/features/public/tag-object";

/**
 * The first screen.
 *
 * The whole product is the picture, in the order it happens: a Tag on the
 * counter, the customer page it opens on a phone, and the owner's Home screen
 * where the rating lands. The Tag overlaps the phone and the NFC arcs join
 * them, so physical and digital read as one thing.
 *
 * The counter photograph is only atmosphere: blurred and washed back, it sets
 * the place without asking to be looked at. Everything sharp is ReviewBoost.
 */

const PATH = [
  { icon: Nfc, label: "Tap or scan the Tag" },
  { icon: Star, label: "Rate 1 to 5" },
  { icon: null, label: "Same Google link, every rating" },
] as const;

export function Hero() {
  return (
    <section className="hero relative isolate overflow-hidden border-b border-border">
      <div aria-hidden="true" className="hero__backdrop">
        <Image
          src="/images/hero-counter-tag.png"
          alt=""
          fill
          sizes="100vw"
          className="object-cover"
          priority
        />
      </div>

      <div className="relative mx-auto grid max-w-[1200px] items-center gap-x-10 gap-y-12 px-5 pb-16 pt-10 sm:px-8 md:pt-16 lg:grid-cols-12 lg:pb-24 lg:pt-20">
        <div className="lg:col-span-5">
          <h1 className="text-[clamp(2.3rem,4vw,3.3rem)] font-bold leading-[1.02] tracking-[-0.04em] text-ink">
            {PUBLIC_HERO.title}
          </h1>
          <p className="mt-6 max-w-[40ch] text-lg leading-relaxed text-muted sm:text-xl">
            {PUBLIC_HERO.lede}
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild variant="action" size="lg" className="rounded-full sm:w-auto sm:px-9">
              <Link href={PUBLIC_HERO.primary.href}>{PUBLIC_HERO.primary.label}</Link>
            </Button>
            <Link
              href="#how-it-works"
              className="inline-flex min-h-12 items-center justify-center rounded-full px-5 text-base font-semibold text-ink transition-colors duration-150 hover:bg-surface/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
            >
              See how it works
            </Link>
          </div>

          {/* The whole product in one line, in the order it happens. */}
          <ol className="mt-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-6 text-sm font-medium text-ink">
            {PATH.map((step, index) => (
              <li key={step.label} className="flex items-center gap-3">
                <span className="flex items-center gap-2">
                  {step.icon ? <step.icon className="size-4 text-brand-text" aria-hidden="true" /> : null}
                  {step.label}
                </span>
                {index < PATH.length - 1 ? (
                  <span aria-hidden="true" className="text-muted">
                    →
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>

        <div className="hero-stage lg:col-span-7">
          {/* Where the rating lands: the owner's real Home screen. */}
          <div className="hero-stage__app">
            <div className="overflow-hidden rounded-[18px] border border-border bg-surface shadow-[var(--shadow-card)]">
              <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <span className="size-2 rounded-full bg-border" aria-hidden="true" />
                <span className="size-2 rounded-full bg-border" aria-hidden="true" />
                <span className="size-2 rounded-full bg-border" aria-hidden="true" />
                <span className="ml-3 rounded-md bg-quiet px-3 py-0.5 text-[11px] text-muted">
                  reviewboost.fit/home
                </span>
              </div>
              <ScaleToFit minWidth={560}>
                <DashboardPreviewSection />
              </ScaleToFit>
            </div>
          </div>

          {/* What the customer sees. */}
          <div className="hero-stage__phone">
            <DemoPhone
              heroSrc="/images/showcase/pizza-hero.png"
              label="The customer page a Tag opens: How was your visit, with five stars"
            />
          </div>

          {/* What they tap: the Tag, touching the phone. */}
          <div className="hero-stage__tag">
            <span aria-hidden="true" className="hero-stage__arcs">
              <span />
              <span />
              <span />
            </span>
            <TagObject size="sm" />
          </div>
        </div>
      </div>
    </section>
  );
}
