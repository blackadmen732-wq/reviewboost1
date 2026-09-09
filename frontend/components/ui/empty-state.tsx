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
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <section className={cn("max-w-[36rem] py-2", className)}>
      <h2 className="text-[length:var(--rb-text-title)] font-semibold tracking-[-0.02em] text-ink">
        {title}
      </h2>
      <p className="mt-2 max-w-[36ch] text-base leading-relaxed text-muted">{description}</p>
      {action ? <div className="mt-8 max-w-xs">{action}</div> : null}
    </section>
  );
}
