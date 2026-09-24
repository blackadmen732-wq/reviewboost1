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
    <header className="mb-10 flex items-end justify-between gap-6">
      <div className="min-w-0">
        <h1 className="rb-display">{title}</h1>
        {description ? (
          <p className="mt-3 max-w-[44ch] text-base leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0 pb-1">{action}</div> : null}
    </header>
  );
}
