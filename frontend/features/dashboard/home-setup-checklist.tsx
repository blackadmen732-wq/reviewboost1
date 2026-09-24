import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { SetupChecklist, SetupChecklistItem } from "@/features/dashboard/home-model";

/**
 * The four things standing between a new business and a working ReviewBoost.
 *
 * Deliberately not a wizard: no steps, no modal, no illustration. Just a
 * short list that tells the owner what is left and gets out of the way the
 * moment it is done — this component returns `null`, not a collapsed shell,
 * once all four are complete, so a finished setup leaves no trace in the
 * layout or the accessibility tree.
 *
 * Exactly one `<Button>` exists here, on whichever row is next. Every other
 * row is a plain link, so there is never a moment where two buttons compete
 * for the same action.
 */
export function HomeSetupChecklist({ checklist }: { checklist: SetupChecklist }) {
  if (checklist.completeCount === checklist.total) return null;

  return (
    <section className="mb-10 max-w-[36rem]" aria-labelledby="setup-checklist-heading">
      <p id="setup-checklist-heading" className="text-sm font-medium text-muted">
        {checklist.completeCount} of {checklist.total} set up
      </p>

      <ul className="mt-3 flex flex-col">
        {checklist.items.map((item) => (
          <ChecklistRow key={item.id} item={item} isNext={checklist.nextIncomplete?.id === item.id} />
        ))}
      </ul>
    </section>
  );
}

function ChecklistRow({ item, isNext }: { item: SetupChecklistItem; isNext: boolean }) {
  if (item.complete) {
    return (
      <li className="flex items-center gap-3 py-2 text-sm text-muted">
        <CheckGlyph />
        <span>{item.label}</span>
      </li>
    );
  }

  if (isNext) {
    return (
      <li className="flex items-center justify-between gap-4 py-3">
        <span className="flex items-center gap-3 text-sm text-ink">
          <CircleGlyph />
          {item.label}
        </span>
        <Button asChild variant="action" size="sm">
          <Link href={item.href}>{checklistActionLabel(item.id)}</Link>
        </Button>
      </li>
    );
  }

  return (
    <li>
      <Link
        href={item.href}
        className="flex items-center gap-3 py-2 text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
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
      <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M6.5 10.2 8.8 12.5 13.5 7.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CircleGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      aria-hidden="true"
      className="shrink-0 text-[color:var(--rb-border-strong)]"
    >
      <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
