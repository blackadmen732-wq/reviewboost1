import Image from "next/image";
import Link from "next/link";
import { Nfc, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DemoPhone } from "@/features/public/demo-phone";
import { PUBLIC_HERO } from "@/features/public/public-copy";
import { TagObject } from "@/features/public/tag-object";

/**
 * The first screen.
 *
 * The product is the picture: the counter, the Tag on it, and the real
 * customer page it opens — the same `CustomerVisitView` a customer's phone
 * renders. The copy states the promise; the scene shows the path.
 *
 * The counter photograph is only the backdrop. The phone and the Tag sit in
 * front of it, so what a visitor reads first is ReviewBoost, not stock
 * scenery.
 */

const PATH = [
  { icon: Nfc, label: "Tap or scan the Tag" },
  { icon: Star, label: "Rate 1 to 5" },
  { icon: null, label: "Same Google link, every rating" },
] as const;

export function Hero() {
  return (
    <section className="overflow-hidden border-b border-border">
      <div className="mx-auto grid max-w-[1200px] items-center gap-x-10 gap-y-12 px-5 pb-16 pt-10 sm:px-8 md:pt-16 lg:grid-cols-12 lg:pb-24 lg:pt-20">
        <div className="lg:col-span-6 lg:self-end">
          <h1 className="text-[clamp(2.4rem,4.4vw,3.6rem)] font-bold leading-[1.02] tracking-[-0.04em] text-ink">
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
              className="inline-flex min-h-12 items-center justify-center rounded-full px-5 text-base font-semibold text-ink transition-colors duration-150 hover:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
            >
              See how it works
            </Link>
          </div>

        </div>

        <div className="hero-scene lg:col-span-6 lg:row-span-2 lg:row-start-1 lg:col-start-7">
          <div className="hero-scene__photo">
            <Image
              src="/images/hero-counter-tag.png"
              alt="A customer at a shop counter holding a phone over a ReviewBoost Tag"
              fill
              sizes="(min-width: 1024px) 460px, 70vw"
              className="object-cover"
              priority
            />
          </div>
          <div className="hero-scene__phone">
            <DemoPhone
              heroSrc="/images/showcase/pizza-hero.png"
              label="The customer page a Tag opens: How was your visit, with five stars"
            />
          </div>
          <div className="hero-scene__tag">
            <TagObject size="sm" />
          </div>
        </div>

        {/* The whole product in one line, in the order it happens. Beside the
            copy on desktop; under the picture on a phone, where it explains
            what the visitor has just seen. */}
        <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-6 text-sm font-medium text-ink lg:col-span-6 lg:row-start-2 lg:self-start">
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
    </section>
  );
}
