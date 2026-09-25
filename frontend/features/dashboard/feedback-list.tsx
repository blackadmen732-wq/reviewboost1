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
              "group -mx-2 flex min-h-14 items-center gap-3 rounded-[var(--radius-control)] px-2 py-3.5",
              "transition-colors duration-150 hover:bg-quiet active:bg-quiet",
              "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
            )}
          >
            {/* Unread is a dot in its own column, so read and unread rows
                keep their stars lined up down the list. */}
            <span className="flex w-2 shrink-0 self-start pt-[0.4rem]" aria-hidden={item.isRead || undefined}>
              {item.isRead ? null : (
                <span className="size-2 rounded-full bg-action" aria-label="Unread" role="img" />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5">
                <Stars rating={item.rating} size="md" />

                {item.isResolved ? (
                  <span className="inline-flex items-center gap-1 text-sm text-muted">
                    <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
                    Sorted
                  </span>
                ) : null}

                <time
                  dateTime={item.submittedAt}
                  className={cn(
                    "ml-auto shrink-0 text-sm tabular-nums",
                    item.isRead ? "text-muted" : "font-medium text-ink",
                  )}
                >
                  {relativeDay(item.submittedAt)}
                </time>
              </div>

              {/* A rating with no message is one line. Saying "Rating only,
                  no message" on every such row was the same sentence, over
                  and over, carrying nothing the stars had not already said. */}
              {item.note ? (
                <p
                  className={cn(
                    "mt-1.5 line-clamp-2 whitespace-pre-wrap text-base leading-relaxed",
                    item.isRead ? "text-muted" : "text-ink",
                  )}
                >
                  {item.note}
                </p>
              ) : null}
            </div>

            <ChevronRight
              className="size-5 shrink-0 text-[color:var(--rb-border-strong)] transition-transform duration-150 group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
