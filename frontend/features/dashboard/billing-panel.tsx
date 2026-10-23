"use client";

import { Lock } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { PUBLIC_PLANS, TRIAL } from "@/features/public/pricing-plans";
import { ownerOnly } from "@/lib/owner/permissions";
import { cn } from "@/lib/utils/cn";
import { withWriteDeadline } from "@/lib/api/read-deadline";
import { supabaseBrowser } from "@/lib/supabase/browser";

class SignedOut extends Error {}

type PlanId = "starter" | "growth" | "pro";
type Status = "trialing" | "active" | "past_due" | "cancelled" | "suspended";

interface Billing {
  planId: PlanId | null;
  status: Status | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  smsBalance: { monthly: number; purchased: number; total: number };
  /** Counted by the server the way the database enforces caps. */
  usage?: {
    locations: { used: number; limit: number };
    tags: { used: number; limit: number };
  } | null;
}

/**
 * The locked plans come from `PUBLIC_PLANS`, the same list the pricing page
 * shows, so the price and trial an owner is offered here cannot drift from it.
 * Nothing about the *current* subscription is taken from that list. What a
 * business has is whatever `billing` says it has.
 */
const PLANS = PUBLIC_PLANS;

/**
 * Only Starter has a trial, and only for a business that has never had a
 * plan: checkout gives no second trial after a cancellation.
 */
function checkoutLabel(
  plan: (typeof PLANS)[number],
  firstSubscription: boolean,
): string {
  if (firstSubscription && plan.trialDays > 0)
    return `Start ${plan.trialDays}-day trial`;
  return `Choose ${plan.name}`;
}

/** The line under each plan's button: what pressing it costs, today. */
function checkoutTerms(
  plan: (typeof PLANS)[number],
  firstSubscription: boolean,
): string {
  if (firstSubscription && plan.trialDays > 0) {
    return `Card required. $${plan.price} a month after ${plan.trialDays} days.`;
  }
  return `Charged $${plan.price} when you subscribe. No trial.`;
}

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
function describe(billing: Billing): {
  title: string;
  body: string;
  tone: "info" | "error";
} {
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
            body: periodEnd
              ? `Your next payment is on ${periodEnd}.`
              : "Your plan is running.",
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
          body: `Your Tags are ready and they are not serving customers yet. Pick a plan below — ${TRIAL.plan} is free for ${TRIAL.days} days.`,
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

type Tone = "success" | "warning" | "danger" | "neutral";

const BADGE: Record<Tone, string> = {
  success: "border-action/40 bg-brand-soft text-brand-text",
  warning: "border-[color:var(--rb-warning)]/40 text-[color:var(--rb-warning)]",
  danger: "border-danger/40 bg-danger-soft text-danger",
  neutral: "border-border bg-quiet text-muted",
};

/** The one word or two that name the state, beside the plan name. */
function badgeFor(billing: Billing): { label: string; tone: Tone } {
  switch (billing.status) {
    case "trialing":
      return {
        label: billing.planId ? `${TRIAL.days}-day trial` : "Trial",
        tone: "success",
      };
    case "active":
      return billing.cancelAtPeriodEnd
        ? { label: "Ending", tone: "warning" }
        : { label: "Active", tone: "success" };
    case "past_due":
      return { label: "Past due", tone: "danger" };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" };
    case "suspended":
      return billing.planId === null
        ? { label: "No plan yet", tone: "neutral" }
        : { label: "Suspended", tone: "danger" };
    default:
      return { label: "Unknown", tone: "neutral" };
  }
}

function Badge({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.04em] ${BADGE[tone]}`}
    >
      {label}
    </span>
  );
}

/**
 * One usage meter. The bar is decoration: the numbers beside it carry the
 * meaning, so it is hidden from assistive technology rather than announced as
 * a second, vaguer copy of the same fact.
 */
function Meter({
  label,
  value,
  detail,
  ratio,
  tone = "action",
}: {
  label: string;
  value: string;
  detail?: string | undefined;
  ratio: number;
  tone?: "action" | "danger";
}) {
  const width = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-muted">{label}</p>
        <p className="text-sm font-semibold text-ink tabular-nums">{value}</p>
      </div>
      <div
        aria-hidden="true"
        className="h-1.5 overflow-hidden rounded-full bg-quiet"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none ${
            tone === "danger" ? "bg-danger" : "bg-action"
          }`}
          style={{ width }}
        />
      </div>
      {detail ? <p className="text-xs text-muted">{detail}</p> : null}
    </div>
  );
}

function count(used: number, limit: number, one: string, many: string): string {
  return `${used} of ${limit} ${limit === 1 ? one : many}`;
}

/**
 * `canManage` is the owner: `api/v1/billing` POST refuses everyone else. An
 * admin, member or viewer reads the same state with no checkout or portal
 * button that would come back 403.
 *
 * Layout follows the approved Billing & Usage frames: the state first (plan,
 * badge, what it means, one action), then what the business is using, then —
 * only when there is no subscription behind it — the plans to choose from.
 */
export function BillingPanel({
  billing,
  canManage,
  selectedPlan = null,
}: {
  billing: Billing;
  canManage: boolean;
  selectedPlan?: PlanId | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const state = describe(billing);
  const badge = badgeFor(billing);
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
      if (!session) throw new SignedOut("Your session expired. Please sign in again.");

      const response = await withWriteDeadline(
        async (signal) =>
          await fetch("/api/v1/billing", {
            signal,
            method: "POST",
            headers: {
              "content-type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify(body),
          }),
      );

      const payload = (await response.json().catch(() => null)) as {
        data?: { url?: string };
        error?: { message?: string };
      } | null;

      if (!response.ok || !payload?.data?.url) {
        setError(
          payload?.error?.message ??
            "That did not go through. Please try again.",
        );
        return;
      }

      window.location.assign(payload.data.url);
    } catch (caught) {
      // A dropped connection reads "Failed to fetch"; nobody should see that.
      setError(
        caught instanceof SignedOut
          ? caught.message
          : "Could not reach ReviewBoost. Check your connection and try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  const currentPlan = PLANS.find((plan) => plan.id === billing.planId);
  const firstSubscription = billing.planId === null;
  // One black button among the plans, as on the pricing page: the plan the
  // owner already picked there, otherwise the trial for a first subscription.
  // The cards used to turn black only on hover, so on a phone there was no
  // main action at all.
  const recommended: PlanId | null =
    selectedPlan ?? (firstSubscription ? (PLANS.find((plan) => plan.trialDays > 0)?.id ?? null) : null);
  const periodEnd = formatDate(billing.currentPeriodEnd);

  // A real problem gets the red banner above everything; the card below then
  // only has to say which plan and offer the fix. Informational states say
  // what they mean inside the card, where the plan is.
  const alarming = state.tone === "error" && billing.status !== "cancelled";

  // Usage is shown while the door is open. During `past_due` the database
  // allows no *new* Tags or locations (its limit is 0) but the plan is still
  // the plan, so the meters measure against the plan and say so.
  const running =
    billing.status === "trialing" ||
    billing.status === "active" ||
    billing.status === "past_due";
  const showUsage = running && billing.usage != null;
  const onTrial = billing.status === "trialing";
  const locationLimitShown =
    billing.status === "past_due"
      ? (currentPlan?.locations ?? 0)
      : (billing.usage?.locations.limit ?? 0);
  const tagLimitShown =
    billing.status === "past_due"
      ? (currentPlan?.tags ?? 0)
      : (billing.usage?.tags.limit ?? 0);
  const monthlyAllowance = onTrial ? 0 : (currentPlan?.monthlyTexts ?? 0);

  // Active is the quietest state: the badge already says it is running, so
  // the card gives the price and the next payment date and nothing else.
  // Every other state needs its sentence — a trial's end, a cancellation's
  // last day — and that sentence already carries the date.
  const quiet = billing.status === "active" && !billing.cancelAtPeriodEnd;
  const factLine = quiet && periodEnd ? `Next payment ${periodEnd}` : null;

  return (
    <div className="flex flex-col gap-8">
      {!canManage ? (
        <p
          className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-quiet px-4 py-3 text-sm text-muted"
          data-billing-access="read-only"
        >
          <Lock className="size-4 shrink-0" aria-hidden="true" />
          {ownerOnly("choose a plan or change payment")}
        </p>
      ) : null}

      {alarming ? (
        <InlineNotice kind="error" title={state.title} blocking>
          <p>{state.body}</p>
        </InlineNotice>
      ) : null}

      {error ? (
        <InlineNotice kind="error" title="That did not go through" blocking>
          <p>{error}</p>
        </InlineNotice>
      ) : null}

      <section
        aria-labelledby="plan-heading"
        className={`flex flex-col gap-6 rounded-[var(--radius-card)] border bg-surface p-5 shadow-[var(--shadow-card)] sm:flex-row sm:items-center sm:justify-between sm:p-7 ${
          badge.tone === "warning"
            ? "border-[color:var(--rb-warning)]/50"
            : "border-border"
        }`}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2
              id="plan-heading"
              className="text-xl font-semibold tracking-[-0.015em] text-ink"
            >
              {currentPlan ? (
                <>
                  <span>{currentPlan.name}</span> plan
                </>
              ) : (
                "No plan yet"
              )}
            </h2>
            {/* "No plan yet" is already the heading; a badge repeating it is noise. */}
            {currentPlan ? <Badge {...badge} /> : null}
          </div>

          {alarming || quiet ? null : (
            <>
              <p className="mt-3 text-base font-medium text-ink">
                {state.title}
              </p>
              <p className="mt-1 max-w-[56ch] text-sm leading-relaxed text-muted">
                {state.body}
              </p>
            </>
          )}

          {/* The price is a running cost only while the plan runs; under a
              cancelled or suspended plan it would read as a live charge. */}
          {currentPlan && running ? (
            <p className="mt-3 text-sm text-muted">
              <span className="font-semibold text-ink">
                ${currentPlan.price}
              </span>{" "}
              a month
              {factLine ? (
                <>
                  {" · "}
                  <span className="font-medium text-ink">{factLine}</span>
                </>
              ) : null}
            </p>
          ) : null}
        </div>

        {canManage && !needsCheckout ? (
          <Button
            type="button"
            variant={billing.status === "past_due" ? "action" : "secondary"}
            className="sm:w-auto sm:shrink-0"
            onClick={() => void act({ action: "portal" }, "portal")}
            loading={busy === "portal"}
            loadingLabel="Opening…"
            disabled={busy !== null}
          >
            {billing.status === "past_due"
              ? "Update payment method"
              : "Manage plan and payment"}
          </Button>
        ) : null}
      </section>

      {showUsage && billing.usage ? (
        <section
          aria-labelledby="usage-heading"
          className="flex flex-col gap-3"
        >
          <h2 id="usage-heading" className="text-base font-semibold text-ink">
            {onTrial ? "During your trial" : "This billing period"}
          </h2>
          <div className="grid items-start gap-3 md:grid-cols-3">
            <Meter
              label="Locations"
              value={count(
                billing.usage.locations.used,
                locationLimitShown,
                "location",
                "locations",
              )}
              ratio={
                locationLimitShown
                  ? billing.usage.locations.used / locationLimitShown
                  : 0
              }
            />
            <Meter
              label="Tags"
              value={count(
                billing.usage.tags.used,
                tagLimitShown,
                "Tag",
                "Tags",
              )}
              detail={
                billing.status === "past_due"
                  ? "New Tags can be added once the payment goes through."
                  : undefined
              }
              ratio={
                tagLimitShown ? billing.usage.tags.used / tagLimitShown : 0
              }
            />
            <Meter
              label="Texts left"
              value={
                onTrial
                  ? "None during the trial"
                  : monthlyAllowance
                    ? `${billing.smsBalance.monthly.toLocaleString("en-US")} of ${monthlyAllowance.toLocaleString("en-US")}`
                    : billing.smsBalance.monthly.toLocaleString("en-US")
              }
              detail={
                billing.smsBalance.purchased > 0
                  ? `Plus ${billing.smsBalance.purchased.toLocaleString("en-US")} purchased — ${billing.smsBalance.total.toLocaleString("en-US")} in total.`
                  : onTrial
                    ? "Your plan's monthly texts arrive with the first payment."
                    : undefined
              }
              ratio={
                monthlyAllowance
                  ? billing.smsBalance.monthly / monthlyAllowance
                  : 0
              }
            />
          </div>
        </section>
      ) : null}

      {canManage && needsCheckout ? (
        <section
          aria-labelledby="plans-heading"
          className="flex flex-col gap-4"
        >
          <div>
            <h2
              id="plans-heading"
              className="text-xl font-semibold tracking-[-0.015em] text-ink"
            >
              Choose a plan
            </h2>
            <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-muted">
              {firstSubscription
                ? `${TRIAL.plan} is free for ${TRIAL.days} days — a card is needed to start, and nothing is charged until the trial ends. Growth and Pro are charged when you subscribe.`
                : "A card is needed. You are charged when you subscribe."}
            </p>
          </div>
          <ul className="grid gap-4 lg:grid-cols-3">
            {PLANS.map((plan) => (
              <li
                key={plan.id}
                data-plan={plan.id}
                data-selected={selectedPlan === plan.id || undefined}
                className={cn(
                  "group flex flex-col rounded-[var(--radius-card)] border bg-surface p-6",
                  selectedPlan === plan.id ? "border-action" : "border-border",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-lg font-semibold text-ink">{plan.name}</p>
                  {selectedPlan === plan.id ? (
                    <span className="text-xs font-medium text-brand-text">
                      Your choice
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-sm text-muted">{plan.fit}</p>
                <p className="mt-5 flex items-baseline gap-1.5">
                  <span className="text-[2.75rem] font-semibold leading-none tracking-[-0.04em] text-ink tabular-nums">
                    ${plan.price}
                  </span>
                  <span className="text-sm text-muted">/ month</span>
                </p>
                <Button
                  type="button"
                  variant={recommended === plan.id ? "action" : "secondary"}
                  className="mt-5"
                  onClick={() =>
                    void act({ action: "checkout", planId: plan.id }, plan.id)
                  }
                  loading={busy === plan.id}
                  loadingLabel="Opening…"
                  disabled={busy !== null}
                >
                  {checkoutLabel(plan, firstSubscription)}
                </Button>
                <p className="mt-2.5 text-center text-xs text-muted">
                  {checkoutTerms(plan, firstSubscription)}
                </p>
                <hr className="my-5 border-border" />
                <dl className="flex flex-col gap-2.5 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Locations</dt>
                    <dd className="font-semibold text-ink tabular-nums">
                      {plan.locations}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Tags</dt>
                    <dd className="font-semibold text-ink tabular-nums">
                      {plan.tags}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Texts a month</dt>
                    <dd className="font-semibold text-ink tabular-nums">
                      {plan.monthlyTexts.toLocaleString("en-US")}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
