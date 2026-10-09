import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * The title of a screen.
 *
 * ONE SIZE, EVERYWHERE
 * --------------------
 * Five owner screens used to set their own `<h1>`, and between them they used
 * three different sizes and two different letter-spacings: 1.75rem/-0.03em on
 * three screens, 1.5rem/-0.02em on five, 1.375rem on Home. Nobody chose that —
 * it is what happens when each screen writes its own heading. On a phone,
 * moving between two of them is visible, and an app whose titles change size as
 * you walk through it does not read as one app.
 *
 * So the title lives here and nowhere else. A screen that needs a different
 * shape asks for it with a prop, which keeps the decision visible instead of
 * letting it drift.
 */
export function PageHeader({
  title,
  description,
  action,
  align = "start",
  tight = false,
}: {
  title: string;
  description?: string | undefined;
  action?: ReactNode;
  /** Centred for the screens that are a single decision — choosing a business. */
  align?: "start" | "center" | undefined;
  /**
   * Half the usual space beneath. For a screen where the title and what follows
   * are one workflow rather than a heading and then a page — the Customer page
   * editor, where title, photo, preview and Publish read as a single thing.
   */
  tight?: boolean | undefined;
}) {
  const centred = align === "center";

  return (
    <header
      className={cn(
        tight ? "mb-6" : "mb-10",
        centred ? "text-center" : "flex items-start justify-between gap-6",
      )}
    >
      <div className="min-w-0">
        <h1 className="text-[length:var(--rb-text-display)] font-semibold tracking-[-0.03em] text-ink">
          {title}
        </h1>
        {description ? (
          <p
            className={cn(
              "mt-2 text-base leading-relaxed text-muted",
              centred ? "mx-auto max-w-[44ch]" : "max-w-[40ch]",
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
