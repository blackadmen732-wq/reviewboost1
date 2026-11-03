import { Check } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Breadcrumbs } from "@/features/public/breadcrumbs";
import {
  CENTS_PER_EXTRA_TEXT,
  EVERY_PLAN,
  PUBLIC_PLANS,
  TEXT_PACKS,
  TRIAL,
  type PublicPlan,
} from "@/features/public/pricing-plans";
import { startForPlan } from "@/lib/owner/plan-choice";

/** "50 ($4), 200 ($16) or 500 ($40)" — read from the pack list, never typed. */
function extraTextPacks(): string {
  const parts = TEXT_PACKS.map((pack) => `${pack.texts.toLocaleString("en-US")} ($${pack.price})`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}` : (parts[0] ?? "");
}

/**
 * The price list, as a visitor reads it.
 *
 * Three comparable cards: who it is for, the price, one action, what it costs to
 * start, and then the three numbers that actually differ — locations, Tags,
 * texts. What every plan includes is said once underneath rather than repeated
 * in each card. A barber deciding between two plans needs one number to
 * differ, not fourteen rows to scan.
 *
 * No plan is highlighted by default and there is no "most popular" badge.
 * Nobody has evidence for which plan is most popular, and inventing it is the
 * small dishonesty that makes the rest of the page read as marketing. A card
 * Starter's existing trial action is primary; that is an offer, not a
 * popularity claim. Hover and focus reinforce the existing border.
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

function PlanCard({
  plan,
  heading: Heading,
}: {
  plan: PublicPlan;
  heading: "h2" | "h3";
}) {
  const [first, second] = startLine(plan);
  const cta =
    plan.trialDays > 0
      ? `Start ${plan.trialDays}-day trial`
      : `Choose ${plan.name}`;

  return (
    <li className="public-plan" data-plan={plan.id}>
      <Heading className="text-xl font-semibold tracking-[-0.015em] text-ink">
        {plan.name}
      </Heading>
      <p className="public-plan__fit">{plan.fit}</p>

      <p className="mt-6 flex items-baseline gap-2">
        <span className="text-[3rem] font-semibold leading-none tracking-[-0.03em] text-ink tabular-nums sm:text-[3.5rem]">
          ${plan.price}
        </span>
        <span className="text-base text-muted">/month</span>
      </p>

      <Button
        asChild
        variant={plan.trialDays > 0 ? "action" : "secondary"}
        className="mt-6 shadow-none"
      >
        <Link href={startForPlan(plan.id)}>{cta}</Link>
      </Button>

      <div className="public-plan__terms mt-3.5 text-center text-sm leading-relaxed text-muted">
        <p>{first}</p>
        <p>{second}</p>
      </div>

      <hr className="my-7 border-border" />

      {/* The three numbers that actually differ between plans. */}
      <p className="mb-3 text-sm font-medium text-ink">Paid plan includes</p>
      <dl className="flex flex-col gap-3.5 text-base">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted">Locations</dt>
          <dd className="font-semibold text-ink tabular-nums">
            {plan.locations}
          </dd>
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

export function PricingTable({
  headingLevel: Heading = "h3",
}: {
  headingLevel?: "h2" | "h3";
}) {
  return (
    <div>
      <ul className="public-plans">
        {PUBLIC_PLANS.map((plan) => (
          <PlanCard key={plan.id} plan={plan} heading={Heading} />
        ))}
      </ul>

      {/* The trial, said once in full: whose it is, what it includes, and
          that a card is needed. The Starter card only has room for the gist. */}
      <p className="mx-auto mt-10 max-w-[60ch] text-center text-sm leading-relaxed text-muted">
        <span className="font-medium text-ink">
          Try {TRIAL.plan} free for {TRIAL.days} days — {TRIAL.tags} Tag,{" "}
          {TRIAL.locations} location.
        </span>{" "}
        {TRIAL.note}
      </p>

      {/* Extra texts, from the same list the Billing page sells from. */}
      <p className="mx-auto mt-3 max-w-[60ch] text-center text-sm leading-relaxed text-muted">
        <span className="font-medium text-ink">Need more texts?</span>{" "}
        {CENTS_PER_EXTRA_TEXT}¢ each, in packs of {extraTextPacks()}. Bought
        texts never expire, and are used after the month&rsquo;s included
        texts.
      </p>

      <section
        aria-labelledby="every-plan-heading"
        className="mx-auto mt-14 max-w-3xl"
      >
        <Heading
          id="every-plan-heading"
          className="text-center text-lg font-semibold tracking-[-0.015em] text-ink"
        >
          Every plan includes
        </Heading>
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
 * Shared pricing presentation follows the public site's actual theme.
 * Prices, quotas and trial restrictions stay in the existing canonical models.
 *
 * `as` chooses the heading level: the pricing page's title, or a section on
 * the home page.
 */
export function PricingSection({
  as: Heading = "h2",
  headline,
  lede,
  children,
  breadcrumb = false,
}: {
  as?: "h1" | "h2";
  headline: string;
  lede: string;
  children?: ReactNode;
  /** The pricing page's own "ReviewBoost / Pricing" trail; never on the home page. */
  breadcrumb?: boolean;
}) {
  return (
    <section className="public-pricing border-y border-border">
      <div className="public-pricing__inner">
        <div className="public-pricing__intro">
          {breadcrumb ? <Breadcrumbs path="/pricing" align="center" /> : null}
          <Heading className="public-display">{headline}</Heading>
          <p className="mx-auto mt-5 max-w-[40ch] text-lg leading-relaxed text-muted">
            {lede}
          </p>
        </div>

        <div className="mt-10 sm:mt-12">
          <PricingTable headingLevel={Heading === "h1" ? "h2" : "h3"} />
        </div>

        {children}
      </div>
    </section>
  );
}
