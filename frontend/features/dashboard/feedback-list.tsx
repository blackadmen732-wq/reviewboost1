import { Check, ChevronRight } from "lucide-react";
import Link from "next/link";

import { Stars } from "@/components/ui/stars";
import { relativeDay } from "@/lib/utils/relative-day";
import { cn } from "@/lib/utils/cn";

/**
 * Calm inbox rows. Gold is stars only. No sentiment colour.
 */

export interface FeedbackItem {
  id: string;
  rating: number;
  note: string | null;
  submittedAt: string;
  isRead: boolean;
  isResolved: boolean;
  noteCount: number;
}

export function FeedbackList({ items }: { items: FeedbackItem[] }) {
  return (
    <ul className="divide-y divide-border border-y border-border">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            href={`/feedback/${item.id}`}
            className={cn(
              "flex min-h-14 items-start gap-3 py-4",
              "transition-colors duration-150 hover:bg-quiet/60",
              "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <Stars rating={item.rating} />

                {item.isRead ? null : (
                  <span className="size-1.5 rounded-full bg-ink" aria-label="Unread" role="img" />
                )}

                {item.isResolved ? (
                  <span className="inline-flex items-center gap-1 text-sm text-muted">
                    <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
                    Sorted
                  </span>
                ) : null}

                <time dateTime={item.submittedAt} className="ml-auto shrink-0 text-sm text-muted">
                  {relativeDay(item.submittedAt)}
                </time>
              </div>

              {item.note ? (
                <p
                  className={cn(
                    "line-clamp-2 whitespace-pre-wrap text-base leading-relaxed",
                    item.isRead ? "text-muted" : "text-ink",
                  )}
                >
                  {item.note}
                </p>
              ) : (
                <p className="text-base italic text-muted">Rating only, no message</p>
              )}
            </div>

            <ChevronRight
              className="mt-1 size-5 shrink-0 text-[color:var(--rb-border-strong)]"
              aria-hidden="true"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
