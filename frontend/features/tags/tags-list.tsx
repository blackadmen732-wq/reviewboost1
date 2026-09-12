import { ChevronRight } from "lucide-react";
import Link from "next/link";

import {
  lastUsedLabel,
  tagReadiness,
  tagReadinessLabel,
} from "@/lib/owner/tag-readiness";
import type { Stand } from "@/lib/server/owner-data";

export function TagsList({ stands }: { stands: Stand[] }) {
  return (
    <ul className="divide-y divide-border border-y border-border">
      {stands.map((stand) => {
        const status = tagReadiness(stand);
        return (
          <li key={stand.standId}>
            <Link
              href={`/stands/${stand.standId}`}
              className="flex min-h-16 items-center gap-3 py-4 hover:bg-quiet/60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-ink">{stand.label}</p>
                <p className="mt-1 text-sm text-muted">
                  {stand.locationName ?? "Place"} · {lastUsedLabel(stand.lastOpenedAt)}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-quiet px-2.5 py-1 text-sm font-medium text-ink">
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
