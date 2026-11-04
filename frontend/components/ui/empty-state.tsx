import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Honest empty: cause, then one action. No decorative icon well.
 */
interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
  icon?: unknown;
  /** h1 when the empty state is the whole page (not found, an error); h2 inside one. */
  headingLevel?: "h1" | "h2";
}

export function EmptyState({ title, description, action, className, headingLevel: Heading = "h2" }: EmptyStateProps) {
  return (
    <section className={cn("max-w-[36rem] py-2", className)}>
      <Heading className="text-[length:var(--rb-text-title)] font-semibold tracking-[-0.02em] text-ink">
        {title}
      </Heading>
      <p className="mt-2 max-w-[36ch] text-base leading-relaxed text-muted">{description}</p>
      {action ? <div className="mt-8 max-w-xs">{action}</div> : null}
    </section>
  );
}
