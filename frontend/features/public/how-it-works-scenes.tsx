import { QrCode, Star } from "lucide-react";

import { DemoPhone } from "@/features/public/demo-phone";
import { HOW_IT_WORKS } from "@/features/public/public-copy";
import { Reveal } from "@/features/public/reveal";
import { NfcPuck } from "@/features/public/tag-object";

/**
 * How it works, as three scenes rather than three matching cards.
 *
 * Each scene shows the one thing that happens at that moment: the physical
 * Tag, the real customer page, and the handoff every rating gets. They
 * alternate composition so the section reads as a sequence.
 *
 * Scene three is careful about what ReviewBoost knows: it opens the business's
 * Google review page for every rating. Whether the customer writes a review
 * there is theirs to decide, and the product never claims one was posted.
 */

const [TAG_STEP, RATE_STEP, CONTINUE_STEP] = HOW_IT_WORKS;

function StepLabel({ number, label }: { number: string; label: string }) {
  return (
    <p className="flex items-baseline gap-3 text-sm font-semibold text-brand-text">
      <span className="font-mono text-base tabular-nums text-muted">{number}</span>
      {label}
    </p>
  );
}

function Stars({ count }: { count: number }) {
  return (
    <span className="flex gap-0.5" aria-label={`${count} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden="true"
          className={n <= count ? "size-3.5 fill-[color:var(--rb-star)] text-[color:var(--rb-star)]" : "size-3.5 text-border"}
        />
      ))}
    </span>
  );
}

/** Five ratings, one destination. Drawn, not animated: the point is sameness. */
function SameDestination() {
  return (
    <div className="grid items-center gap-6 md:grid-cols-[auto_1fr_auto] md:gap-0">
      <ul className="flex justify-center gap-2 md:flex-col md:gap-3">
        {[1, 2, 3, 4, 5].map((count) => (
          <li
            key={count}
            className="rounded-full border border-border bg-surface px-3 py-2 shadow-[var(--shadow-control)] md:px-4"
          >
            <span className="hidden md:inline">
              <Stars count={count} />
            </span>
            <span className="flex items-center gap-1 text-sm font-semibold text-ink md:hidden">
              {count}
              <Star className="size-3.5 fill-[color:var(--rb-star)] text-[color:var(--rb-star)]" aria-hidden="true" />
            </span>
          </li>
        ))}
      </ul>

      {/* Five lines into one: every rating arrives at the same place. */}
      <svg
        className="hidden h-[236px] w-full md:block"
        viewBox="0 0 200 236"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {[18, 68, 118, 168, 218].map((y) => (
          <path
            key={y}
            d={`M 0 ${y} C 90 ${y}, 110 118, 200 118`}
            fill="none"
            stroke="var(--rb-brand)"
            strokeWidth="1.5"
            strokeDasharray="4 5"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <p aria-hidden="true" className="text-center text-2xl text-muted md:hidden">
        ↓
      </p>

      <div className="mx-auto w-full max-w-[300px] rounded-[22px] border border-border bg-surface p-6 shadow-[var(--shadow-card)]">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Opens</p>
        <p className="mt-2 text-lg font-semibold tracking-[-0.01em] text-ink">
          The business&apos;s Google review page
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          The same page, whichever star they tapped. Writing a review is up to them.
        </p>
      </div>
    </div>
  );
}

export function HowItWorksScenes() {
  return (
    <section id="how-it-works" className="scroll-mt-24 border-b border-border">
      <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-28">
        <Reveal>
          <h2 className="max-w-[18ch] text-[clamp(2rem,4vw,3.25rem)] font-bold leading-[1.05] tracking-[-0.035em] text-ink">
            How it works
          </h2>
          <p className="mt-4 max-w-[44ch] text-lg leading-relaxed text-muted">
            Three moments at the counter. Nothing to install, nothing to sign up for.
          </p>
        </Reveal>

        {/* 01 — the physical Tag. Visual first, big. */}
        <Reveal className="mt-16 grid items-center gap-10 md:mt-20 md:grid-cols-12 md:gap-12">
          <div className="relative h-[380px] overflow-hidden rounded-[32px] bg-quiet sm:h-[440px] md:col-span-7">
            {/* A phone coming down onto the Tag. Still, not animated: the
                moment itself is the point. */}
            <div className="absolute left-1/2 top-[-46%] w-[200px] -translate-x-1/2 rotate-[-10deg] sm:top-[-42%] sm:w-[220px]">
              <DemoPhone
                heroSrc="/images/showcase/pizza-hero.png"
                label="A phone held over a ReviewBoost Tag"
                baseWidth={280}
              />
            </div>
            <span
              aria-hidden="true"
              className="absolute bottom-[25%] left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5"
            >
              {[40, 64, 88].map((width) => (
                <span
                  key={width}
                  className="h-2.5 rounded-t-full border-x-2 border-t-2 border-brand/60"
                  style={{ width }}
                />
              ))}
            </span>
            <div className="absolute bottom-[-24%] left-1/2 -translate-x-1/2 sm:bottom-[-20%]">
              <NfcPuck />
            </div>
            <span className="absolute left-5 top-5 flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm font-medium text-ink shadow-[var(--shadow-control)]">
              <QrCode className="size-4 text-brand-text" aria-hidden="true" />
              Or scan the printed code
            </span>
          </div>
          <div className="md:col-span-5">
            <StepLabel number="01" label="Tap or scan" />
            <h3 className="mt-4 text-[clamp(1.6rem,2.6vw,2.25rem)] font-bold leading-[1.1] tracking-[-0.025em] text-ink">
              {TAG_STEP?.title}
            </h3>
            <p className="mt-4 max-w-[36ch] text-lg leading-relaxed text-muted">{TAG_STEP?.body}</p>
          </div>
        </Reveal>

        {/* 02 — the customer page. Copy first, the phone large on the right. */}
        <Reveal className="mt-20 grid items-center gap-10 md:mt-28 md:grid-cols-12 md:gap-12">
          <div className="order-2 md:order-1 md:col-span-5 md:col-start-2">
            <StepLabel number="02" label="Rate" />
            <h3 className="mt-4 text-[clamp(1.6rem,2.6vw,2.25rem)] font-bold leading-[1.1] tracking-[-0.025em] text-ink">
              {RATE_STEP?.title}
            </h3>
            <p className="mt-4 max-w-[36ch] text-lg leading-relaxed text-muted">{RATE_STEP?.body}</p>
            <p className="mt-4 max-w-[36ch] text-base leading-relaxed text-muted">
              Your photo on top, one question, five stars. Every rating reaches you privately.
            </p>
          </div>
          <div className="order-1 mx-auto w-full max-w-[300px] md:order-2 md:col-span-5 md:col-start-8">
            <DemoPhone
              heroSrc="/images/showcase/salon-hero.png"
              label="A customer page with four of five stars selected"
              value={4}
            />
          </div>
        </Reveal>

        {/* 03 — the handoff. Full width: five ratings, one destination. */}
        <Reveal className="mt-20 md:mt-28">
          <div className="mx-auto max-w-[44rem] text-center">
            <div className="flex justify-center">
              <StepLabel number="03" label="Continue" />
            </div>
            <h3 className="mt-4 text-[clamp(1.6rem,2.6vw,2.25rem)] font-bold leading-[1.1] tracking-[-0.025em] text-ink">
              {CONTINUE_STEP?.title}
            </h3>
            <p className="mx-auto mt-4 max-w-[46ch] text-lg leading-relaxed text-muted">
              {CONTINUE_STEP?.body}
            </p>
          </div>
          <div className="mx-auto mt-12 max-w-[760px]">
            <SameDestination />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
