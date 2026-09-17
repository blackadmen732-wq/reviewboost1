import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EVERY_PLAN, PUBLIC_PLANS, TRIAL } from "@/features/public/pricing-plans";
import { START_HREF } from "@/features/public/public-copy";

/**
 * The price list, as a visitor reads it.
 *
 * Three cards and a trial line. No comparison grid: a barber deciding between
 * $49 and $79 needs one number to differ, not fourteen rows to scan. What every
 * plan includes is said once underneath rather than repeated in each card.
 *
 * Deliberately restrained — one bordered surface, no shadows, no "most popular"
 * badge. Nobody has evidence for which plan is most popular, and inventing that
 * badge is the small dishonesty that makes the rest of the page feel like
 * marketing rather than a price list.
 */
export function PricingTable() {
  return (
    <div>
      <ul className="grid gap-4 sm:grid-cols-3">
        {PUBLIC_PLANS.map((plan) => (
          <li
            key={plan.id}
            className="flex flex-col rounded-[var(--radius-card)] border border-border bg-surface p-6"
          >
            <h3 className="text-base font-semibold text-ink">{plan.name}</h3>
            <p className="mt-1 text-sm text-muted">{plan.fit}</p>

            <p className="mt-5 flex items-baseline gap-1">
              <span className="text-[2rem] font-semibold leading-none tracking-[-0.03em] text-ink">
                ${plan.price}
              </span>
              <span className="text-sm text-muted">/month</span>
            </p>

            {/* The three numbers that actually differ between plans. */}
            <dl className="mt-6 flex flex-col gap-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Locations</dt>
                <dd className="font-medium text-ink">{plan.locations}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Tags</dt>
                <dd className="font-medium text-ink">{plan.tags}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Texts a month</dt>
                <dd className="font-medium text-ink">{plan.monthlyTexts.toLocaleString()}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      <div className="mt-8 rounded-[var(--radius-card)] border border-border bg-quiet p-6">
        <p className="text-base font-medium text-ink">
          Start with {TRIAL.days} days free — {TRIAL.tags} Tag, {TRIAL.locations} location.
        </p>
        <p className="mt-2 max-w-[48ch] text-sm leading-relaxed text-muted">{TRIAL.note}</p>
        <div className="mt-5 max-w-xs">
          <Button asChild variant="action" size="lg">
            <Link href={START_HREF}>Start {TRIAL.days}-day trial</Link>
          </Button>
        </div>
      </div>

      <ul className="mt-8 flex flex-col gap-2">
        {EVERY_PLAN.map((item) => (
          <li key={item} className="flex gap-3 text-sm text-muted">
            <span aria-hidden="true" className="text-brand">
              —
            </span>
            {item}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted">On every plan.</p>
    </div>
  );
}
