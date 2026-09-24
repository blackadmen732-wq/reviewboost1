import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Honest empty: cause, then one action. Generous air is the design — an
 * empty screen should feel calm, not broken.
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
    <section className={cn("max-w-[36rem] py-10", className)}>
      <h2 className="rb-title">{title}</h2>
      <p className="mt-3 max-w-[36ch] text-base leading-relaxed text-muted">{description}</p>
      {action ? <div className="mt-8 max-w-xs">{action}</div> : null}
    </section>
  );
}
