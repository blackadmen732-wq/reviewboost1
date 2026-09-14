"use client";

import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ALL_PLAN_IDS,
  PLAN_CATALOG,
  TRIAL_DAYS,
  formatPlanPrice,
  type PlanId,
} from "@/lib/owner/plan-catalog";
import { cn } from "@/lib/utils/cn";

interface PlanPickerProps {
  selectedPlan: PlanId | null;
  onSelect: (planId: PlanId) => void;
  onContinue: () => void;
  busy?: boolean;
  showTrialNote?: boolean;
}

export function PlanPicker({
  selectedPlan,
  onSelect,
  onContinue,
  busy = false,
  showTrialNote = true,
}: PlanPickerProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {ALL_PLAN_IDS.map((planId) => {
          const plan = PLAN_CATALOG[planId];
          const selected = selectedPlan === planId;

          return (
            <button
              key={planId}
              type="button"
              onClick={() => onSelect(planId)}
              className={cn(
                "flex items-start gap-4 rounded-[var(--radius-card)] border-2 p-5 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
                selected
                  ? "border-brand bg-brand-soft/30"
                  : "border-border bg-surface hover:border-muted",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2",
                  selected ? "border-brand bg-brand" : "border-border",
                )}
              >
                {selected ? (
                  <Check className="size-3.5 text-white" strokeWidth={3} aria-hidden="true" />
                ) : null}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="text-lg font-semibold text-ink">{plan.name}</span>
                  <span className="text-lg font-semibold tabular-nums text-ink">
                    {formatPlanPrice(plan)}
                  </span>
                  <span className="text-sm text-muted">/mo</span>
                </span>
                <span className="mt-1 block text-sm text-muted">{plan.description}</span>
              </span>
            </button>
          );
        })}
      </div>

      {showTrialNote ? (
        <p className="text-center text-sm text-muted">
          {TRIAL_DAYS}-day free trial. Card required. Cancel anytime.
        </p>
      ) : null}

      <Button
        size="lg"
        disabled={!selectedPlan}
        loading={busy}
        loadingLabel="Setting up…"
        onClick={onContinue}
      >
        {showTrialNote ? "Start free trial" : "Change plan"}
      </Button>
    </div>
  );
}
