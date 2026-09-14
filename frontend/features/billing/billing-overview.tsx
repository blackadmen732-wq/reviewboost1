"use client";

import { AlertTriangle, Calendar, CreditCard, Package } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import {
  billingStateBadgeVariant,
  billingStateLabel,
  formatDate,
  trialDaysLeftLabel,
  type SubscriptionState,
} from "@/lib/owner/billing";
import {
  ALL_PLAN_IDS,
  PLAN_CATALOG,
  formatPlanPrice,
  formatPlanPricePerMonth,
  type PlanId,
} from "@/lib/owner/plan-catalog";
import { cn } from "@/lib/utils/cn";

interface BillingOverviewProps {
  state: SubscriptionState;
  planId: PlanId;
  trialDaysLeft: number | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  smsSegmentsUsed: number;
  smsSegmentsIncluded: number;
}

export function BillingOverview({
  state,
  planId,
  trialDaysLeft,
  trialEndsAt,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  smsSegmentsUsed,
  smsSegmentsIncluded,
}: BillingOverviewProps) {
  const plan = PLAN_CATALOG[planId];
  const badgeVariant = billingStateBadgeVariant(state);
  const [showPlanChange, setShowPlanChange] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-ink">{plan.name}</h2>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  badgeVariant === "success" && "bg-green-100 text-green-800",
                  badgeVariant === "warning" && "bg-amber-100 text-amber-800",
                  badgeVariant === "error" && "bg-red-100 text-red-800",
                  badgeVariant === "neutral" && "bg-gray-100 text-gray-800",
                )}
              >
                {billingStateLabel(state)}
              </span>
            </div>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
              {formatPlanPricePerMonth(plan)}
            </p>
          </div>
          <Package className="size-6 shrink-0 text-muted" aria-hidden="true" />
        </div>

        {state === "trialing" && trialDaysLeft !== null ? (
          <div className="mt-4">
            <div className="flex items-center gap-2 text-sm font-medium text-brand-text">
              <Calendar className="size-4" aria-hidden="true" />
              {trialDaysLeftLabel(trialDaysLeft)}
            </div>
            {trialEndsAt ? (
              <p className="mt-1 text-sm text-muted">
                Trial ends {formatDate(trialEndsAt)}. Your card will be charged{" "}
                {formatPlanPrice(plan)} if you keep the plan.
              </p>
            ) : null}
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-brand transition-all"
                style={{ width: `${Math.max(0, Math.min(100, ((7 - (trialDaysLeft ?? 0)) / 7) * 100))}%` }}
              />
            </div>
          </div>
        ) : null}

        {state === "past_due" ? (
          <div className="mt-4">
            <InlineNotice kind="error">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                Payment failed. Update your card to keep your account active.
              </div>
            </InlineNotice>
          </div>
        ) : null}

        {state === "cancelled" ? (
          <div className="mt-4">
            <InlineNotice kind="error">
              Your subscription is cancelled. Resubscribe to restore access.
            </InlineNotice>
          </div>
        ) : null}

        {state === "suspended" ? (
          <div className="mt-4">
            <InlineNotice kind="error">
              Your account is suspended due to payment failure. Update your payment method to resume.
            </InlineNotice>
          </div>
        ) : null}

        {cancelAtPeriodEnd && state === "active" ? (
          <div className="mt-4">
            <InlineNotice kind="warning">
              Your plan will cancel at the end of this period ({formatDate(currentPeriodEnd)}).
            </InlineNotice>
          </div>
        ) : null}
      </section>

      <section className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Text Request segments
        </h3>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums text-ink">
            {smsSegmentsIncluded - smsSegmentsUsed}
          </span>
          <span className="text-sm text-muted">
            of {smsSegmentsIncluded} remaining this period
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-brand transition-all"
            style={{
              width: `${smsSegmentsIncluded > 0 ? Math.min(100, (smsSegmentsUsed / smsSegmentsIncluded) * 100) : 0}%`,
            }}
          />
        </div>
      </section>

      {currentPeriodEnd && state === "active" && !cancelAtPeriodEnd ? (
        <section className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
          <div className="flex items-center gap-3">
            <CreditCard className="size-5 text-muted" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm text-muted">Next billing date</p>
              <p className="text-base font-medium text-ink">{formatDate(currentPeriodEnd)}</p>
            </div>
          </div>
        </section>
      ) : null}

      <div className="flex flex-col gap-3">
        {state !== "none" && state !== "cancelled" && state !== "suspended" ? (
          <Button variant="secondary" onClick={() => setShowPlanChange(!showPlanChange)}>
            {showPlanChange ? "Hide plans" : "Change plan"}
          </Button>
        ) : null}

        {showPlanChange ? (
          <div className="flex flex-col gap-3">
            {ALL_PLAN_IDS.filter((id) => id !== planId).map((id) => {
              const other = PLAN_CATALOG[id];
              return (
                <button
                  key={id}
                  type="button"
                  disabled
                  className="flex items-center justify-between rounded-[var(--radius-card)] border border-border bg-surface p-4 opacity-60"
                >
                  <span>
                    <span className="font-medium text-ink">{other.name}</span>
                    <span className="ml-2 text-sm text-muted">
                      {formatPlanPricePerMonth(other)}
                    </span>
                  </span>
                  <span className="text-xs text-muted">Stripe not connected</span>
                </button>
              );
            })}
            <p className="text-center text-xs text-muted">
              Plan changes will be available once Stripe is connected.
            </p>
          </div>
        ) : null}

        {state === "past_due" || state === "suspended" ? (
          <Button variant="primary" disabled>
            Update payment method
          </Button>
        ) : null}

        {state === "cancelled" ? (
          <Button variant="primary" disabled>
            Resubscribe
          </Button>
        ) : null}

        {state === "active" && !cancelAtPeriodEnd ? (
          <Button variant="ghost" disabled className="text-sm">
            Cancel subscription
          </Button>
        ) : null}

        {cancelAtPeriodEnd && state === "active" ? (
          <Button variant="primary" disabled>
            Resume subscription
          </Button>
        ) : null}

        <p className="text-center text-xs text-muted">
          Billing actions will be enabled once Stripe is connected.
        </p>
      </div>
    </div>
  );
}
