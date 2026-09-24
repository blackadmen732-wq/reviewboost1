import { ChevronRight, QrCode } from "lucide-react";
import Link from "next/link";

import {
  lastUsedLabel,
  tagReadiness,
  tagReadinessLabel,
} from "@/lib/owner/tag-readiness";
import type { Stand } from "@/lib/server/owner-data";
import { cn } from "@/lib/utils/cn";

/**
 * Tags are physical objects that live on counters and tables, so the list
 * treats them that way: each row leads with the object (its code), then its
 * name and place, then the one thing the owner still has to do — if anything.
 */
export function TagsList({ stands }: { stands: Stand[] }) {
  return (
    <ul className="rb-list">
      {stands.map((stand) => {
        const status = tagReadiness(stand);
        const ready = status === "ready";
        return (
          <li key={stand.standId}>
            <Link
              href={`/stands/${stand.standId}`}
              className="flex items-center gap-4 px-5 py-4 transition-colors duration-150 hover:bg-quiet/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[color:var(--rb-focus-soft)]"
            >
              <span
                aria-hidden="true"
                className="grid size-12 shrink-0 place-items-center rounded-[12px] border border-border bg-quiet text-ink"
              >
                <QrCode className="size-6" strokeWidth={1.75} />
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-ink">{stand.label}</p>
                <p className="mt-0.5 truncate text-sm text-muted">
                  {stand.locationName ?? "Place"} · {lastUsedLabel(stand.lastOpenedAt)}
                </p>
              </div>

              <span
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-sm font-medium",
                  ready ? "bg-brand-soft text-brand-text" : "bg-quiet text-muted",
                )}
              >
                {tagReadinessLabel(status)}
              </span>
              <ChevronRight className="size-5 shrink-0 text-[color:var(--rb-border-strong)]" aria-hidden="true" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
