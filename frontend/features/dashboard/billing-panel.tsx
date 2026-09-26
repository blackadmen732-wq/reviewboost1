"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { PUBLIC_PLANS, type PublicPlanId } from "@/lib/plans";
import { supabaseBrowser } from "@/lib/supabase/browser";

type PlanId = PublicPlanId;
type Status = "trialing" | "active" | "past_due" | "cancelled" | "suspended";

interface Billing {
  planId: PlanId | null;
  status: Status | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  smsBalance: { monthly: number; purchased: number; total: number };
}

/**
 * The pricing table reads the shared plan list. Nothing about the *current*
 * subscription is taken from it — what a business has is whatever `billing`
 * says it has.
 */
const PLANS = PUBLIC_PLANS;

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * What to say about each state, and whether service is running.
 *
 * `past_due` deliberately reads as "still working": a failed card does not
 * close a business's door, and telling an owner their Tags are dead when they
 * are not would send them to replace hardware that is fine.
 */
function describe(billing: Billing): { title: string; body: string; tone: "info" | "error" } {
  const periodEnd = formatDate(billing.currentPeriodEnd);
  const trialEnd = formatDate(billing.trialEndsAt);

  switch (billing.status) {
    case "trialing":
      // Only Stripe puts a business here, and Stripe only does it after a card
      // and a plan — except for businesses that predate billing, who were
      // given a finite trial by a migration and have neither. Telling them
      // their card is on file would be a lie they find out about later.
      if (billing.planId === null) {
        return {
          title: "You are on a free trial",
          body: trialEnd
            ? `Your trial ends on ${trialEnd}. Choose a plan before then to keep your Tags working.`
            : "Choose a plan to keep your Tags working when the trial ends.",
          tone: "info",
        };
      }
      return {
        title: "You are on a free trial",
        body: trialEnd
          ? `Your trial ends on ${trialEnd}. Your card is on file and your plan starts then.`
          : "Your card is on file and your plan starts when the trial ends.",
        tone: "info",
      };
    case "active":
      return billing.cancelAtPeriodEnd
        ? {
            title: "Your plan ends soon",
            body: periodEnd
              ? `Everything keeps working until ${periodEnd}. After that your Tags stop serving customers, and nothing is deleted.`
              : "Everything keeps working until the end of this billing period.",
            tone: "info",
          }
        : {
            title: "Your plan is active",
            body: periodEnd ? `Your next payment is on ${periodEnd}.` : "Your plan is running.",
            tone: "info",
          };
    case "past_due":
      return {
        title: "Your last payment did not go through",
        body: "Your Tags are still working. Update your card to keep it that way.",
        tone: "error",
      };
    case "cancelled":
      return {
        title: "Your plan is cancelled",
        body: "Your Tags are not serving customers. Everything — your codes, your ratings, your settings — is still here, and the same Tags start working again the moment you subscribe.",
        tone: "error",
      };
    case "suspended":
      // Suspended with no plan is not a punishment: it is every business that
      // has not been through checkout yet, including one that signed up a
      // minute ago. Saying "suspended" to them would be alarming and wrong.
      if (billing.planId === null) {
        return {
          title: "Choose a plan to open your Tags",
          body: "Your Tags are ready and they are not serving customers yet. Pick a plan below — Starter comes with seven days free.",
          tone: "info",
        };
      }
      return {
        title: "Your account is suspended",
        body: "Your Tags are not serving customers. Nothing has been deleted.",
        tone: "error",
      };
    default:
      return {
        title: "We could not read your plan",
        body: "Reload the page. If this keeps happening, get in touch before making any changes.",
        tone: "error",
      };
  }
}

export function BillingPanel({ billing }: { billing: Billing }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const state = describe(billing);
  // Anyone without a subscription behind them needs to start one. A trial
  // with no plan is a business that predates billing, not one that has paid.
  const needsCheckout =
    billing.status === null ||
    billing.status === "cancelled" ||
    billing.status === "suspended" ||
    (billing.status === "trialing" && billing.planId === null);

  async function act(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabaseBrowser().auth.getSession();
      if (!session) throw new Error("Your session expired. Please sign in again.");

      const response = await fetch("/api/v1/billing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });

      const payload = (await response.json().catch(() => null)) as {
        data?: { url?: string };
        error?: { message?: string };
      } | null;

      if (!response.ok || !payload?.data?.url) {
        setError(payload?.error?.message ?? "That did not go through. Please try again.");
        return;
      }

      window.location.assign(payload.data.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const currentPlan = PLANS.find((plan) => plan.id === billing.planId);

  return (
    <div className="flex flex-col gap-6">
      <InlineNotice kind={state.tone} title={state.title} blocking={state.tone === "error"}>
        <p>{state.body}</p>
      </InlineNotice>

      {error ? (
        <InlineNotice kind="error" title="That did not go through" blocking>
          <p>{error}</p>
        </InlineNotice>
      ) : null}

      {currentPlan ? (
        <section className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <h2 className="text-sm font-medium text-muted">Your plan</h2>
          <p className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-ink">
            {currentPlan.name}
          </p>
          <dl className="mt-3 grid gap-1 text-sm text-muted sm:grid-cols-3">
            <div className="flex gap-2">
              <dt>Places</dt>
              <dd className="font-medium text-ink">{currentPlan.locations}</dd>
            </div>
            <div className="flex gap-2">
              <dt>Tags</dt>
              <dd className="font-medium text-ink">{currentPlan.tags}</dd>
            </div>
            <div className="flex gap-2">
              <dt>Messages a month</dt>
              <dd className="font-medium text-ink">{currentPlan.sms}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-muted">
            You have <span className="font-medium text-ink">{billing.smsBalance.total}</span>{" "}
            {billing.smsBalance.total === 1 ? "message" : "messages"} left —{" "}
            {billing.smsBalance.monthly} included and {billing.smsBalance.purchased} purchased.
          </p>
        </section>
      ) : null}

      {needsCheckout ? (
        <section aria-labelledby="plans-heading">
          <h2 id="plans-heading" className="mb-1 text-base font-semibold text-ink">
            Choose a plan
          </h2>
          <p className="mb-4 text-sm text-muted">
            Starter has a seven-day free trial: a card is needed to start, and you are not
            charged until it ends. Growth and Pro are charged when you choose them.
          </p>
          <ul className="grid gap-3 sm:grid-cols-3">
            {PLANS.map((plan) => (
              <li
                key={plan.id}
                className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
              >
                <div>
                  <p className="text-base font-semibold text-ink">{plan.name}</p>
                  <p className="text-2xl font-semibold tracking-[-0.02em] text-ink">
                    ${plan.priceUsd}
                    <span className="text-sm font-normal text-muted"> a month</span>
                  </p>
                </div>
                <ul className="flex flex-col gap-1 text-sm text-muted">
                  <li>
                    {plan.locations} {plan.locations === 1 ? "place" : "places"}
                  </li>
                  <li>
                    {plan.tags} {plan.tags === 1 ? "Tag" : "Tags"}
                  </li>
                  <li>{plan.sms} text messages a month</li>
                </ul>
                <Button
                  type="button"
                  onClick={() => void act({ action: "checkout", planId: plan.id }, plan.id)}
                  loading={busy === plan.id}
                  loadingLabel="Opening…"
                  disabled={busy !== null}
                >
                  {plan.trialDays ? `Start ${plan.trialDays}-day trial` : `Choose ${plan.name}`}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <Button
          type="button"
          variant="secondary"
          onClick={() => void act({ action: "portal" }, "portal")}
          loading={busy === "portal"}
          loadingLabel="Opening…"
          disabled={busy !== null}
        >
          Manage plan and payment
        </Button>
      )}
    </div>
  );
}
