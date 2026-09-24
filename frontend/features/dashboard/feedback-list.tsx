import { Check, ChevronRight } from "lucide-react";
import Link from "next/link";

import { Stars } from "@/components/ui/stars";
import { relativeDay } from "@/lib/utils/relative-day";
import { cn } from "@/lib/utils/cn";

/**
 * The inbox. Ratings are the centerpiece: stars first, large enough to read
 * at arm's length, the note directly under them. Gold is stars only — an
 * unread dot is green, the one other signal colour the product allows itself.
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
    <ul className="rb-list">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            href={`/feedback/${item.id}`}
            className={cn(
              "flex items-start gap-3 px-5 py-4",
              "transition-colors duration-150 hover:bg-quiet/50",
              "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[color:var(--rb-focus-soft)]",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5">
                <Stars rating={item.rating} size="md" />

                {item.isRead ? null : (
                  <span className="size-2 rounded-full bg-brand" aria-label="Unread" role="img" />
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
                    "mt-1.5 line-clamp-2 whitespace-pre-wrap text-base leading-relaxed",
                    item.isRead ? "text-muted" : "text-ink",
                  )}
                >
                  {item.note}
                </p>
              ) : (
                <p className="mt-1.5 text-base italic text-muted">Rating only, no message</p>
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
