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
 * A deep field, one photograph, two objects.
 *
 * The photograph is a real counter with a phone being tapped against a Tag —
 * the product's entire premise, already in the frame. It used to be blurred
 * to 28px at 40% opacity behind a light grey wash, which is a way of paying
 * for a photograph and then throwing it away. It carries the section now,
 * under a scrim that is nearly opaque where the headline sits.
 *
 * The field is `.rb-public-dark`: the same green-black the pricing and
 * closing bands already use, so the site now opens on the brand's own colour
 * rather than on grey. Nothing in the palette changed to do it.
 *
 * What is sharp is still only ReviewBoost: the customer page on a phone, and
 * the Tag that opens it. The owner's Home used to float here too, in a
 * browser window too small to read; it has a band of its own further down
 * where it is legible, and taking it out of the hero is what buys the air.
 */

const PATH = [
  { icon: Nfc, label: "Tap or scan the Tag" },
  { icon: Star, label: "Rate 1 to 5" },
  { icon: null, label: "Same Google link, every rating" },
] as const;

export function Hero() {
  return (
    <section className="hero rb-public-dark relative isolate overflow-hidden bg-canvas text-ink">
      <div aria-hidden="true" className="hero__backdrop">
        <Image
          src="/images/hero-counter-tag.png"
          alt=""
          fill
          sizes="100vw"
          className="object-cover object-[68%_58%]"
          priority
        />
      </div>
      <div aria-hidden="true" className="hero__wash" />

      <div className="relative z-10 mx-auto grid max-w-[1200px] items-center gap-x-12 gap-y-14 px-5 pb-20 pt-14 sm:px-8 md:pt-20 lg:grid-cols-12 lg:pb-32 lg:pt-28">
        <div className="hero__copy lg:col-span-5">
          <p className="rb-eyebrow">Tap or scan &middot; No app for them</p>
          <h1 className="mt-6 text-[clamp(2.6rem,5vw,4rem)] font-bold leading-[0.98] tracking-[-0.045em] text-ink">
            {PUBLIC_HERO.title}
          </h1>
          <p className="mt-7 max-w-[42ch] text-lg leading-relaxed text-muted sm:text-xl">
            {PUBLIC_HERO.lede}
          </p>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild variant="action" size="lg" className="rounded-full sm:w-auto sm:px-9">
              <Link href={PUBLIC_HERO.primary.href}>{PUBLIC_HERO.primary.label}</Link>
            </Button>
            <Link
              href="#how-it-works"
              className="inline-flex min-h-12 items-center justify-center rounded-full px-5 text-base font-semibold text-ink transition-colors duration-150 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
            >
              See how it works
            </Link>
          </div>

          {/* The whole product in one line, in the order it happens. */}
          <ol className="mt-12 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-7 text-sm font-medium text-ink">
            {PATH.map((step, index) => (
              <li key={step.label} className="flex items-center gap-3">
                {/* The arrow leads its own step rather than trailing the one
                    before it, so a wrap starts the next line with "-> Same
                    Google link" instead of ending the last one pointing at
                    nothing. */}
                {index > 0 ? (
                  <span aria-hidden="true" className="text-muted">
                    &rarr;
                  </span>
                ) : null}
                <span className="flex items-center gap-2">
                  {step.icon ? <step.icon className="size-4 text-brand-text" aria-hidden="true" /> : null}
                  {step.label}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="hero-stage lg:col-span-7">
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
