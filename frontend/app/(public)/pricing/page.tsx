import type { Metadata } from "next";
import { Check } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  ALL_PLAN_IDS,
  PLAN_CATALOG,
  TRIAL_DAYS,
  formatPlanPrice,
} from "@/lib/owner/plan-catalog";
import { PRICING, START_HREF } from "@/features/public/public-copy";
import { PublicArticle } from "@/features/public/public-article";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Starter $49, Growth $79, Pro $129 per month per location. 7-day free trial.",
};

export default function PricingPage() {
  return (
    <PublicArticle title={PRICING.headline} lede={PRICING.lede}>
      <p>
        Every plan starts with a {TRIAL_DAYS}-day free trial. Card required.
        Cancel anytime before the trial ends and you will not be charged.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {ALL_PLAN_IDS.map((planId) => {
          const plan = PLAN_CATALOG[planId];
          const isGrowth = planId === "growth";

          return (
            <div
              key={planId}
              className={cn(
                "flex flex-col rounded-[var(--radius-card)] border-2 p-6",
                isGrowth ? "border-brand bg-brand-soft/20" : "border-border bg-surface",
              )}
            >
              <h2 className="text-lg font-semibold text-ink">{plan.name}</h2>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-3xl font-bold tabular-nums text-ink">
                  {formatPlanPrice(plan)}
                </span>
                <span className="text-sm text-muted">/mo</span>
              </div>

              <ul className="mt-4 flex flex-1 flex-col gap-2">
                <PlanFeature>
                  {plan.locationLimit} {plan.locationLimit === 1 ? "location" : "locations"}
                </PlanFeature>
                <PlanFeature>
                  {plan.tagLimit} {plan.tagLimit === 1 ? "tag" : "tags"}
                </PlanFeature>
                <PlanFeature>
                  {plan.smsSegmentsIncluded.toLocaleString()} text segments
                </PlanFeature>
              </ul>

              <div className="mt-6">
                <Button asChild variant={isGrowth ? "primary" : "secondary"} className="w-full">
                  <Link href={START_HREF}>Start free trial</Link>
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-6">
        A location is one place with its own Tags and its own Google review link.
        That is the unit we charge for — not a seat, not a scan.
      </p>
      <p>{PRICING.caveat}</p>
    </PublicArticle>
  );
}

function PlanFeature({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm text-ink">
      <Check className="mt-0.5 size-4 shrink-0 text-brand-text" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}
