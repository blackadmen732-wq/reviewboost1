import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

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
        "mx-auto grid max-w-md justify-items-center gap-4 py-12 text-center",
        className,
      )}
    >
      {Icon ? (
        <span className="grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand-text">
          <Icon className="size-6" aria-hidden="true" />
        </span>
      ) : null}
      <div className="grid gap-2">
        <h2 className="text-xl font-semibold tracking-tight text-ink">
          {title}
        </h2>
        <p className="m-0 text-base leading-6 text-muted">{description}</p>
      </div>
      {action ? <div className="mt-1 w-full max-w-xs">{action}</div> : null}
    </section>
  );
}
