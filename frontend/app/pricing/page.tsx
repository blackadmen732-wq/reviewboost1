import { Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Wordmark } from "@/components/brand/wordmark";
import { Container } from "@/components/layout/container";
import { buttonVariants } from "@/components/ui/button";
import { PUBLIC_PLANS, PUBLIC_TRIAL_LIMITS, type PublicPlan } from "@/lib/plans";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = {
  title: "Pricing — ReviewBoost",
  description:
    "Simple monthly plans for local businesses. Starter, Growth and Pro — pick by locations, Tags and text requests.",
};

/**
 * The public pricing page.
 *
 * This is marketing, not billing. It helps someone choose; `Settings → Billing`
 * tells an owner what they already have and stays driven by the backend.
 *
 * The page renders inside `.dark` so it uses the existing warm dark tokens —
 * near-black, charcoal, off-white and ReviewBoost green — rather than a second
 * palette invented for one page.
 *
 * No plan is highlighted by default. Suggesting one plan is "best" is a sales
 * decision nobody has made; a card earns the green treatment when someone
 * points at it or tabs into it.
 */

const SHARED = [
  { title: "Customer Page", body: "A page with your name on it for every tap and scan." },
  { title: "QR + NFC Tags", body: "Customers tap or scan. No app, no account." },
  { title: "Every rating reaches you", body: "One to five stars, all of them, privately." },
  { title: "Text Requests", body: "Ask customers who already visited, by SMS." },
  { title: "Owner app", body: "Ratings, Tags and settings from your phone." },
  { title: "No review gating", body: "Every customer gets the same Google review link." },
] as const;

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

function finePrint(plan: PublicPlan): [string, string] {
  if (plan.trialDays) {
    return [
      `Card required. $${plan.priceUsd}/month after ${plan.trialDays} days.`,
      `The trial includes ${plural(PUBLIC_TRIAL_LIMITS.tags, "Tag", "Tags")} and no text requests.`,
    ];
  }
  return ["Charged when you subscribe.", "No free trial."];
}

function PlanCard({ plan }: { plan: PublicPlan }) {
  const [first, second] = finePrint(plan);
  const cta = plan.trialDays ? `Start ${plan.trialDays}-day trial` : `Choose ${plan.name}`;

  return (
    <li
      className={cn(
        "group flex flex-col rounded-[28px] border border-border bg-surface p-7 sm:p-9",
        "shadow-[0_1px_2px_rgb(0_0_0/30%),0_24px_64px_-30px_rgb(0_0_0/85%)]",
        "transition-[transform,border-color,box-shadow] duration-200 ease-out",
        "hover:border-brand/55 hover:shadow-[0_1px_2px_rgb(0_0_0/30%),0_32px_80px_-32px_rgb(0_168_107/38%)]",
        "focus-within:border-brand/55 focus-within:shadow-[0_1px_2px_rgb(0_0_0/30%),0_32px_80px_-32px_rgb(0_168_107/38%)]",
        "motion-safe:hover:-translate-y-[3px] motion-safe:focus-within:-translate-y-[3px]",
      )}
    >
      <h2 className="text-xl font-semibold tracking-[-0.015em] text-ink">{plan.name}</h2>
      <p className="mt-2 text-[0.95rem] leading-relaxed text-muted lg:min-h-[3.25rem]">
        {plan.audience}
      </p>

      <p className="mt-8 flex items-baseline gap-2">
        <span className="text-[4.5rem] font-semibold leading-none tracking-[-0.05em] text-ink tabular-nums sm:text-[5.25rem]">
          ${plan.priceUsd}
        </span>
        <span className="text-base text-muted">/month</span>
      </p>

      <Link
        href="/login"
        className={cn(
          buttonVariants({ variant: "secondary", size: "lg" }),
          "mt-8 border-ink bg-ink text-canvas shadow-none duration-200",
          "hover:border-brand hover:bg-brand hover:text-on-brand",
          "group-hover:border-brand group-hover:bg-brand group-hover:text-on-brand",
          "group-focus-within:border-brand group-focus-within:bg-brand group-focus-within:text-on-brand",
        )}
      >
        {cta}
      </Link>

      <div className="mt-4 text-center text-sm leading-relaxed text-muted">
        <p>{first}</p>
        <p>{second}</p>
      </div>

      <hr className="my-8 border-border" />

      <dl className="flex flex-col gap-4 text-base">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted">Locations</dt>
          <dd className="font-semibold text-ink tabular-nums">{plan.locations}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted">Tags</dt>
          <dd className="font-semibold text-ink tabular-nums">{plan.tags}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted">Text requests</dt>
          <dd className="font-semibold text-ink tabular-nums">
            {plan.sms.toLocaleString("en-US")}
            <span className="font-normal text-muted"> / month</span>
          </dd>
        </div>
      </dl>
    </li>
  );
}

export default function PricingPage() {
  return (
    <div data-dark-page className="dark min-h-dvh bg-canvas text-ink">
      <Container as="header" size="marketing" className="flex items-center justify-between py-6">
        <Link href="/" aria-label="ReviewBoost home" className="rounded-md">
          <Wordmark size="md" />
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/support" className="text-muted transition-colors hover:text-ink">
            Support
          </Link>
          <Link
            href="/login"
            className="font-medium text-ink underline-offset-4 transition-colors hover:text-brand-text hover:underline"
          >
            Sign in
          </Link>
        </nav>
      </Container>

      <main>
        <Container size="marketing" className="pb-24 pt-12 sm:pt-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="inline-flex rounded-full border border-brand/40 bg-brand-soft px-3.5 py-1 text-sm font-medium text-brand-text">
              Pricing
            </p>
            <h1 className="mt-6 text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.035em] text-ink sm:text-6xl">
              Simple plans for local businesses.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-muted sm:text-xl">
              Start with what you need.
              <br />
              Upgrade when your business needs more.
            </p>
          </div>

          <ul className="mx-auto mt-14 grid max-w-xl gap-5 sm:mt-20 lg:max-w-none lg:grid-cols-3 lg:gap-6">
            {PUBLIC_PLANS.map((plan) => (
              <PlanCard key={plan.id} plan={plan} />
            ))}
          </ul>

          <section
            aria-labelledby="shared-heading"
            className="mx-auto mt-20 max-w-4xl border-t border-border pt-14 sm:mt-24"
          >
            <h2
              id="shared-heading"
              className="text-center text-2xl font-semibold tracking-[-0.02em] text-ink"
            >
              Every plan includes
            </h2>
            <ul className="mt-10 grid gap-x-10 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
              {SHARED.map((item) => (
                <li key={item.title} className="flex gap-3">
                  <Check
                    className="mt-0.5 size-5 shrink-0 text-brand-text"
                    strokeWidth={2.5}
                    aria-hidden="true"
                  />
                  <div>
                    <p className="font-medium text-ink">{item.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>

            <p className="mt-14 text-center text-sm text-muted">
              You can change plans later. Need help choosing?{" "}
              <Link
                href="/support"
                className="font-medium text-ink underline underline-offset-4 hover:text-brand-text"
              >
                Talk to us
              </Link>
              .
            </p>
          </section>
        </Container>
      </main>
    </div>
  );
}
