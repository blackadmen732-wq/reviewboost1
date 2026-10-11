import { Card } from "@/components/ui/card";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { SetupChecklist, SetupChecklistItem } from "@/features/dashboard/home-model";

/**
 * The four things standing between a new business and a working ReviewBoost.
 *
 * Deliberately not a wizard: no steps, no modal, no illustration. One calm
 * card that says what is left, shows honest progress as a thin track, and
 * gets out of the way the moment it is done — this component returns `null`,
 * not a collapsed shell, once all four are complete, so a finished setup
 * leaves no trace in the layout or the accessibility tree.
 *
 * Exactly one `<Button>` exists here, on whichever row is next. Every other
 * row is a plain link, so there is never a moment where two buttons compete
 * for the same action.
 */
export function HomeSetupChecklist({ checklist }: { checklist: SetupChecklist }) {
  if (checklist.completeCount === checklist.total) return null;

  const progress = checklist.completeCount / checklist.total;

  return (
    <Card as="section" className="mb-12 max-w-[36rem]" aria-labelledby="setup-checklist-heading">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="setup-checklist-heading" className="text-base font-semibold text-ink">
          Get set up
        </h2>
        <p className="text-sm text-muted">
          {checklist.completeCount} of {checklist.total}
        </p>
      </div>

      {/* A thin track, not a dashboard bar: honest progress at a glance. */}
      <div
        className="mt-3 h-1 overflow-hidden rounded-full bg-quiet"
        role="progressbar"
        aria-valuenow={checklist.completeCount}
        aria-valuemin={0}
        aria-valuemax={checklist.total}
        aria-label="Setup progress"
      >
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      <ul className="mt-2 flex flex-col">
        {checklist.items.map((item) => (
          <ChecklistRow key={item.id} item={item} isNext={checklist.nextIncomplete?.id === item.id} />
        ))}
      </ul>
    </Card>
  );
}

function ChecklistRow({ item, isNext }: { item: SetupChecklistItem; isNext: boolean }) {
  if (item.complete) {
    return (
      <li className="flex items-center gap-3 py-2.5 text-sm text-muted">
        <CheckGlyph />
        <span>{item.label}</span>
      </li>
    );
  }

  if (isNext) {
    return (
      <li className="flex items-center justify-between gap-4 py-3">
        <span className="flex items-center gap-3 text-sm font-medium text-ink">
          <CircleGlyph current />
          {item.label}
        </span>
        <Button asChild variant="action" size="sm" className="w-auto">
          <Link href={item.href}>{checklistActionLabel(item.id)}</Link>
        </Button>
      </li>
    );
  }

  return (
    <li>
      <Link
        href={item.href}
        className="flex items-center gap-3 py-2.5 text-sm text-muted underline-offset-4 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
      >
        <CircleGlyph />
        {item.label}
      </Link>
    </li>
  );
}

/** The action word for the checklist's one real button, per goal. */
function checklistActionLabel(id: SetupChecklistItem["id"]): string {
  switch (id) {
    case "subscription":
      return "Choose a plan";
    case "destination":
      return "Add link";
    case "customerPage":
      return "Publish";
    case "firstTag":
      return "Create Tag";
  }
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true" className="shrink-0 text-brand">
      <circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.14" />
      <path
        d="M6.5 10.2 8.8 12.5 13.5 7.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CircleGlyph({ current = false }: { current?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      aria-hidden="true"
      className={current ? "shrink-0 text-ink" : "shrink-0 text-[color:var(--rb-border-strong)]"}
    >
      <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.5" />
      {current ? <circle cx="10" cy="10" r="3.5" fill="currentColor" /> : null}
    </svg>
  );
}
