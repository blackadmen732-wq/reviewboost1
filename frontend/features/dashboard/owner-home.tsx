import { Check, ChevronRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { FeedbackList, type FeedbackItem } from "@/features/dashboard/feedback-list";
import {
  type Attention,
  type HomeModel,
  type HomePrimary,
  type SetupStep,
  tagStatusLine,
} from "@/features/dashboard/home-model";
import { PreviewCustomerPage } from "@/features/dashboard/preview-customer-page";
import { SetupSeen } from "@/features/dashboard/setup-seen";
import { cn } from "@/lib/utils/cn";

/**
 * Owner Home. One question: do I need to do anything?
 *
 * The answer is the biggest thing on the screen. Everything else — the week's
 * number, unread rows, Tags — is quieter and underneath, in the same order
 * every time so a glance between customers finds it where it was yesterday.
 *
 * A business with no ratings yet gets its setup as a short checklist built
 * from real state, with the one action on the step it is on.
 */

export function OwnerHome({
  businessName,
  model,
  unreadItems,
  insightsLine = null,
  seenDone = null,
  pulse = null,
}: {
  businessName: string;
  model: HomeModel;
  unreadItems: FeedbackItem[];
  /**
   * The 30-day picture: three numbers, the trend, and the split. It replaces
   * the single "4.3 average · 84 ratings · Improving" line, which answered
   * "how are we doing" with a sentence an owner had to read rather than see.
   */
  pulse?: React.ReactNode;
  /**
   * The setup steps this browser last showed as done, or null if it never has.
   * A step done since then draws its tick once; nothing animates on a first
   * visit, where everything would be "new".
   */
  seenDone?: readonly string[] | null;
  /** "4.3 average · 84 ratings · Improving", or null when there is not enough to say. */
  insightsLine?: string | null;
}) {
  return (
    <div className="flex flex-col">
      <header className="mb-8">
        <h1 className="text-[1.375rem] font-semibold tracking-[-0.02em] text-ink">
          {businessName}
        </h1>
      </header>

      {model.kind === "empty" ? (
        <EmptyHome model={model} seenDone={seenDone} />
      ) : (
        <ActiveHome
          model={model}
          unreadItems={unreadItems}
          insightsLine={insightsLine}
          pulse={pulse}
        />
      )}
    </div>
  );
}

/** "Needs you" or "All good", with a dot that carries the same meaning. */
function StateLabel({ calm }: { calm: boolean }) {
  return (
    <p className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-muted">
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full", calm ? "bg-brand" : "bg-star")}
      />
      {calm ? "All good" : "Needs you"}
    </p>
  );
}

function PrimaryAction({ primary }: { primary: HomePrimary | null }) {
  if (!primary) return null;
  return (
    <div className="mt-6 max-w-sm">
      <Button asChild variant="action" size="lg">
        <Link href={primary.href}>{primary.label}</Link>
      </Button>
    </div>
  );
}

function StateTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[length:var(--rb-text-display)] font-semibold leading-[1.1] tracking-[-0.03em] text-ink">
      {children}
    </p>
  );
}

function EmptyHome({ model, seenDone }: { model: HomeModel; seenDone: readonly string[] | null }) {
  const blocker = model.attentions[0] ?? null;

  return (
    <section className="max-w-[36rem]">
      <StateLabel calm={!blocker} />
      {blocker ? (
        <>
          <StateTitle>{blocker.title}</StateTitle>
          <p className="mt-3 max-w-[40ch] text-base leading-relaxed text-muted">{blocker.body}</p>
        </>
      ) : (
        <>
          <StateTitle>No ratings yet.</StateTitle>
          <p className="mt-3 max-w-[34ch] text-base leading-relaxed text-muted">
            Your tag is ready. Put it where people pay.
          </p>
        </>
      )}

      <PrimaryAction primary={model.primary} />

      {model.setup ? <SetupSteps steps={model.setup} seenDone={seenDone} /> : null}

      {model.showPreview && model.previewStandId ? (
        <PreviewCustomerPage standId={model.previewStandId} />
      ) : null}
    </section>
  );
}

/**
 * Where the business is in getting set up. Plain rows, not cards: a tick and
 * a line for what is done, and the current step in ink. The action for the
 * current step is the green button above, so there is still only one.
 */
function SetupSteps({ steps, seenDone }: { steps: SetupStep[]; seenDone: readonly string[] | null }) {
  // The photo is optional and has its own link, so "the step you are on" —
  // the one the green button above is for — skips it.
  const current = steps.findIndex((step) => !step.done && step.key !== "photo");
  const doneCount = steps.filter((step) => step.done).length;
  // Done since this browser last looked: the tick draws once, and the step
  // that is now current takes its ink just after. Nothing else moves.
  const fresh = (step: SetupStep) => seenDone !== null && step.done && !seenDone.includes(step.key);
  const advanced = steps.some(fresh);

  return (
    <section className="mt-10" aria-labelledby="setup-heading">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="setup-heading" className="text-sm font-medium text-muted">
          Getting set up
        </h2>
        <p className="text-sm tabular-nums text-muted">
          {doneCount} of {steps.length}
        </p>
      </div>
      <SetupSeen done={steps.filter((step) => step.done).map((step) => step.key)} />
      <ol className="divide-y divide-border border-y border-border">
        {steps.map((step, index) => {
          const isCurrent = index === current;
          const drawn = fresh(step);
          return (
            <li
              key={step.key}
              className="flex min-h-14 items-center gap-4 py-3"
              aria-current={isCurrent ? "step" : undefined}
              data-setup-step={step.key}
              data-done={step.done || undefined}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full text-[0.8125rem] font-semibold tabular-nums",
                  step.done && "bg-brand-soft text-brand-text",
                  !step.done && isCurrent && "bg-ink text-canvas",
                  !step.done && !isCurrent && "border border-border text-muted",
                  drawn && "animate-step-done",
                  !step.done && isCurrent && advanced && "animate-step-current",
                )}
                data-fresh={drawn || undefined}
              >
                {step.done ? (
                  drawn ? (
                    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" pathLength={1} className="animate-check-draw" />
                    </svg>
                  ) : (
                    <Check className="size-4" strokeWidth={3} />
                  )
                ) : (
                  index + 1
                )}
              </span>
              {step.href ? (
                // Optional, so it never takes the green button: the row itself
                // goes to the Customer Page editor while it is undone.
                <Link
                  href={step.href}
                  className="-my-3 flex min-h-14 flex-1 items-center justify-between gap-3 py-3 text-base text-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
                >
                  {step.title}
                  <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted" />
                </Link>
              ) : (
                <span
                  className={cn(
                    "text-base",
                    step.done && "text-muted line-through decoration-border",
                    !step.done && isCurrent && "font-semibold text-ink",
                    !step.done && !isCurrent && "text-muted",
                  )}
                >
                  {step.title}
                  {step.done ? <span className="sr-only"> — done</span> : null}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ActiveHome({
  model,
  unreadItems,
  insightsLine,
  pulse,
}: {
  model: HomeModel;
  unreadItems: FeedbackItem[];
  insightsLine: string | null;
  pulse: React.ReactNode;
}) {
  const [firstAttention, ...otherAttentions] = model.attentions;

  return (
    <div className="flex flex-col gap-10">
      <section className="max-w-[36rem]">
        <StateLabel calm={!firstAttention} />
        {firstAttention ? (
          <>
            <StateTitle>{firstAttention.title}</StateTitle>
            <p className="mt-3 max-w-[40ch] text-base leading-relaxed text-muted">
              {firstAttention.body}
            </p>
          </>
        ) : (
          <>
            <StateTitle>Nothing needs you</StateTitle>
            <p className="mt-3 text-base leading-relaxed text-muted">
              Everything is working. Get back to your customers.
            </p>
          </>
        )}

        <PrimaryAction primary={model.primary} />

        {otherAttentions.length > 0 ? <AlsoNeeds attentions={otherAttentions} /> : null}
      </section>

      {model.headline ? (
        <section aria-label="This week">
          <p className="text-lg font-semibold tracking-[-0.01em] text-ink">{model.headline}</p>
        </section>
      ) : null}

      {/* The 30-day picture. It is the one place Home shows numbers, and it
          shows them as a picture: an owner between customers reads a shape
          faster than a sentence. */}
      {pulse ?? (insightsLine ? (
        <section>
          <Link
            href="/feedback/insights"
            className="group -mx-2 flex min-h-14 items-center gap-3 rounded-[var(--radius-control)] px-2 transition-colors hover:bg-quiet active:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-muted">Last 30 days</span>
              <span className="block text-base text-ink">{insightsLine}</span>
            </span>
            <span className="shrink-0 text-sm font-medium text-brand-text">View insights</span>
            <ChevronRight
              aria-hidden="true"
              className="size-5 shrink-0 text-muted transition-transform duration-150 group-hover:translate-x-0.5"
            />
          </Link>
        </section>
      ) : null)}

      {unreadItems.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-medium text-muted">Unread feedback</h2>
          <FeedbackList items={unreadItems} />
        </section>
      ) : null}

      <section>
        <Link
          href="/stands"
          className="group -mx-2 flex min-h-14 items-center gap-3 rounded-[var(--radius-control)] px-2 transition-colors hover:bg-quiet active:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-muted">Tags</span>
            <span className="block text-base text-ink">{tagStatusLine(model.tagStatus)}</span>
          </span>
          <ChevronRight
            aria-hidden="true"
            className="size-5 text-muted transition-transform duration-150 group-hover:translate-x-0.5"
          />
        </Link>
      </section>
    </div>
  );
}

/**
 * Everything else that needs doing, by name. Home used to show only the first
 * item, so a business with an unread complaint and a broken Google link was
 * told about the complaint and never about the link.
 */
function AlsoNeeds({ attentions }: { attentions: Attention[] }) {
  return (
    <div className="mt-8">
      <p className="mb-2 text-sm font-medium text-muted">Also</p>
      <ul className="flex flex-col gap-2">
        {attentions.map((attention) => (
          <li key={attention.kind} className="flex items-start gap-3 text-base text-ink">
            <span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-full bg-star" />
            {attention.title}
          </li>
        ))}
      </ul>
    </div>
  );
}
