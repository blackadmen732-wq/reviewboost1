import { Check } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  EVERY_PLAN,
  PUBLIC_PLANS,
  TRIAL,
  type PublicPlan,
} from "@/features/public/pricing-plans";
import { START_HREF } from "@/features/public/public-copy";
import { cn } from "@/lib/utils/cn";

/**
 * The price list, as a visitor reads it.
 *
 * Three tall cards: who it is for, the price, one action, what it costs to
 * start, and then the three numbers that actually differ — locations, Tags,
 * texts. What every plan includes is said once underneath rather than repeated
 * in each card. A barber deciding between two plans needs one number to
 * differ, not fourteen rows to scan.
 *
 * No plan is highlighted by default and there is no "most popular" badge.
 * Nobody has evidence for which plan is most popular, and inventing it is the
 * small dishonesty that makes the rest of the page read as marketing. A card
 * earns the green treatment when someone points at it or tabs into it.
 *
 * The component uses theme tokens only, so it reads correctly on a light
 * page, a dark page, or inside a `.dark` band.
 */

function startLine(plan: PublicPlan): [string, string] {
  if (plan.trialDays > 0) {
    return [
      `Card required. Nothing is charged for ${plan.trialDays} days.`,
      `The trial includes ${TRIAL.tags} Tag and no texts.`,
    ];
  }
  return ["Charged when you subscribe.", "No trial on this plan."];
}

function PlanCard({ plan }: { plan: PublicPlan }) {
  const [first, second] = startLine(plan);
  const cta = plan.trialDays > 0 ? `Start ${plan.trialDays}-day trial` : `Choose ${plan.name}`;

  return (
    <li
      className={cn(
        "group flex flex-col rounded-[24px] border border-border bg-surface p-7 sm:p-8",
        "shadow-[var(--shadow-card)]",
        "transition-[transform,border-color,box-shadow] duration-200 ease-out",
        "hover:border-action focus-within:border-action",
        "hover:shadow-[0_1px_2px_rgb(0_0_0/6%),0_28px_64px_-30px_rgb(0_122_77/45%)]",
        "focus-within:shadow-[0_1px_2px_rgb(0_0_0/6%),0_28px_64px_-30px_rgb(0_122_77/45%)]",
        "motion-safe:hover:-translate-y-[3px] motion-safe:focus-within:-translate-y-[3px]",
      )}
      data-plan={plan.id}
    >
      <h3 className="text-xl font-semibold tracking-[-0.015em] text-ink">{plan.name}</h3>
      <p className="mt-1.5 text-[0.95rem] leading-relaxed text-muted">{plan.fit}</p>

      <p className="mt-7 flex items-baseline gap-2">
        <span className="text-[4rem] font-semibold leading-none tracking-[-0.05em] text-ink tabular-nums sm:text-[4.5rem]">
          ${plan.price}
        </span>
        <span className="text-base text-muted">/month</span>
      </p>

      <Button
        asChild
        variant="secondary"
        size="lg"
        className={cn(
          "mt-7 border-ink bg-ink text-canvas shadow-none duration-200 hover:border-action hover:bg-action hover:text-on-action",
          "group-hover:border-action group-hover:bg-action group-hover:text-on-action",
          "group-focus-within:border-action group-focus-within:bg-action group-focus-within:text-on-action",
        )}
      >
        <Link href={START_HREF}>{cta}</Link>
      </Button>

      <div className="mt-3.5 text-center text-sm leading-relaxed text-muted">
        <p>{first}</p>
        <p>{second}</p>
      </div>

      <hr className="my-7 border-border" />

      {/* The three numbers that actually differ between plans. */}
      <dl className="flex flex-col gap-3.5 text-base">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted">Locations</dt>
          <dd className="font-semibold text-ink tabular-nums">{plan.locations}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted">Tags</dt>
          <dd className="font-semibold text-ink tabular-nums">{plan.tags}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted">Texts a month</dt>
          <dd className="font-semibold text-ink tabular-nums">
            {plan.monthlyTexts.toLocaleString("en-US")}
          </dd>
        </div>
      </dl>
    </li>
  );
}

export function PricingTable() {
  return (
    <div>
      <ul className="mx-auto grid max-w-xl gap-5 lg:max-w-none lg:grid-cols-3 lg:gap-6">
        {PUBLIC_PLANS.map((plan) => (
          <PlanCard key={plan.id} plan={plan} />
        ))}
      </ul>

      {/* The trial, said once in full: whose it is, what it includes, and
          that a card is needed. The Starter card only has room for the gist. */}
      <p className="mx-auto mt-10 max-w-[60ch] text-center text-sm leading-relaxed text-muted">
        <span className="font-medium text-ink">
          Try {TRIAL.plan} free for {TRIAL.days} days — {TRIAL.tags} Tag, {TRIAL.locations}{" "}
          location.
        </span>{" "}
        {TRIAL.note}
      </p>

      <section aria-labelledby="every-plan-heading" className="mx-auto mt-14 max-w-3xl">
        <h3
          id="every-plan-heading"
          className="text-center text-lg font-semibold tracking-[-0.015em] text-ink"
        >
          Every plan includes
        </h3>
        <ul className="mt-7 grid gap-x-10 gap-y-4 sm:grid-cols-2">
          {EVERY_PLAN.map((item) => (
            <li key={item} className="flex gap-3 text-base text-ink">
              <Check
                className="mt-0.5 size-5 shrink-0 text-action"
                strokeWidth={2.5}
                aria-hidden="true"
              />
              {item}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * The pricing band: a full-width dark section on an otherwise light site, so
 * the one place a visitor compares prices is unmistakable. It sets `.dark` on
 * itself and uses the ordinary tokens inside, so there is no second palette.
 *
 * `as` chooses the heading level: the pricing page's title, or a section on
 * the home page.
 */
export function PricingSection({
  as: Heading = "h2",
  headline,
  lede,
  children,
}: {
  as?: "h1" | "h2";
  headline: string;
  lede: string;
  children?: ReactNode;
}) {
  return (
    <section className="dark border-y border-border bg-canvas text-ink">
      <div className="mx-auto max-w-[1180px] px-5 py-20 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="inline-flex rounded-full border border-action/40 bg-brand-soft px-3.5 py-1 text-sm font-medium text-brand-text">
            Pricing
          </p>
          <Heading className="mt-6 text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.035em] text-ink sm:text-[3.5rem]">
            {headline}
          </Heading>
          <p className="mx-auto mt-5 max-w-[34ch] text-lg leading-relaxed text-muted sm:text-xl">
            {lede}
          </p>
        </div>

        <div className="mt-14 sm:mt-16">
          <PricingTable />
        </div>

        {children}
      </div>
    </section>
  );
}
