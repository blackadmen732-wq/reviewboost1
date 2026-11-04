import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string | undefined;
  action?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-col items-start justify-between gap-5 sm:flex-row sm:gap-6">
      <div className="min-w-0">
        <h1 className="text-[length:var(--rb-text-display)] font-semibold tracking-[-0.03em] text-ink">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-[40ch] text-base leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
