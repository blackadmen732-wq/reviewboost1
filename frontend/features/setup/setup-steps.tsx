import { Check, ChevronDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { currentStep, type SetupStepView } from "@/features/setup/setup-model";
import { cn } from "@/lib/utils/cn";

/**
 * Setup, as three numbered steps. One sentence and at most one button per
 * step; the button sits only on the step to do next, so there is never a
 * question of what to press. "Show me how" opens plain instructions in place.
 */
export function SetupSteps({
  steps,
  createTag,
}: {
  steps: readonly SetupStepView[];
  /** The "Create a Tag" button, shown on step 2 while there is no Tag yet. */
  createTag?: ReactNode;
}) {
  const next = currentStep(steps);
  const doneCount = steps.filter((step) => step.done).length;

  // Finished, the steps fold into one line. Three done steps with three
  // buttons pushed the Tags themselves, the thing an owner now comes here
  // for, below the first screen. "Show me how" is still a tap away.
  if (doneCount === steps.length) {
    return (
      <details className="group/done mb-10 rounded-[var(--radius-card)] border border-border bg-surface" data-setup-done>
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-[var(--radius-card)] px-4 py-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)] [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-text">
            <Check className="size-4" strokeWidth={2.5} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-ink">All set. Everything is working.</span>
            <span className="block text-sm text-muted group-open/done:hidden">Show the {steps.length} setup steps</span>
            <span className="hidden text-sm text-muted group-open/done:block">Hide the setup steps</span>
          </span>
          <ChevronDown className="size-5 shrink-0 text-muted transition-transform group-open/done:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
        </summary>
        <div className="border-t border-border">
          <StepList steps={steps} next={next} createTag={createTag} />
        </div>
      </details>
    );
  }

  return (
    <section aria-labelledby="setup-steps-heading" className="mb-10">
      <h2 id="setup-steps-heading" className="mb-3 text-sm font-medium text-muted">
        {`${doneCount} of ${steps.length} done`}
      </h2>
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        <StepList steps={steps} next={next} createTag={createTag} />
      </div>
    </section>
  );
}

function StepList({
  steps,
  next,
  createTag,
}: {
  steps: readonly SetupStepView[];
  next: SetupStepView["key"] | null;
  createTag?: ReactNode;
}) {
  return (
      <ol className="divide-y divide-border">
        {steps.map((step) => {
          const isNext = step.key === next;
          return (
            <li key={step.key} data-setup-step={step.key} aria-current={isNext ? "step" : undefined} className="p-5">
              <div className="flex items-start gap-4">
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold tabular-nums",
                    step.done
                      ? "bg-brand-soft text-brand-text"
                      : isNext
                        ? "bg-action text-on-action"
                        : "border border-[color:var(--rb-border-strong)] text-muted",
                  )}
                >
                  {step.done ? <Check className="size-4" strokeWidth={2.5} /> : step.number}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-ink">
                    {step.title}
                    {step.done ? <span className="sr-only"> (done)</span> : null}
                  </h3>
                  <p className="mt-1 text-base leading-relaxed text-muted">{step.body}</p>

                  {step.action && (isNext || step.done) ? (
                    <Button
                      asChild
                      variant={isNext ? "action" : "secondary"}
                      size="sm"
                      className="mt-4 w-full sm:w-auto"
                    >
                      <Link href={step.action.href}>{step.action.label}</Link>
                    </Button>
                  ) : step.key === "tag" && isNext && createTag ? (
                    <div className="mt-4">{createTag}</div>
                  ) : null}

                  <details className="group mt-3">
                    <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-medium text-ink underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
                      Show me how
                      <ChevronDown className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
                    </summary>
                    <ol className="mt-2 list-decimal space-y-2 pl-5 text-base leading-relaxed text-ink">
                      {step.howTo.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ol>
                  </details>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
  );
}
