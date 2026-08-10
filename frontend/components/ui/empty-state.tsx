import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * What a screen shows before it has anything to show.
 *
 * Every empty state in this product explains the *cause*, not just the absence.
 * "Nothing yet" alone reads as broken to someone who is not sure they set the
 * thing up correctly — and this audience is rarely sure. "When a customer scans
 * your code, what they say shows up here" turns an empty screen into a sentence
 * that says the product is working and waiting.
 *
 * Rendered as a bordered card rather than bare centred text, so it occupies the
 * same visual slot the real content will. A screen that changes shape when data
 * arrives feels unfinished.
 */

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <section
      className={cn(
        "flex flex-col items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface px-6 py-16 text-center",
        className,
      )}
    >
      {Icon ? (
        <span className="grid size-16 place-items-center rounded-full bg-quiet">
          <Icon className="size-8 text-muted" aria-hidden="true" />
        </span>
      ) : null}

      <div className="grid gap-2">
        <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {/* Measure-capped: a long explanation set across a desktop card becomes
            a paragraph nobody reads. */}
        <p className="m-0 max-w-[32ch] text-base leading-relaxed text-muted">{description}</p>
      </div>

      {action ? <div className="mt-1 w-full max-w-xs">{action}</div> : null}
    </section>
  );
}
