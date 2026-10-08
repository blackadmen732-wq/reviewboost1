import { Check, ChevronRight, MessageCircle } from "lucide-react";
import Link from "next/link";

import { Stars } from "@/components/ui/stars";
import { relativeDay } from "@/lib/utils/relative-day";
import { cn } from "@/lib/utils/cn";

/**
 * The inbox, one card per rating. Gold is stars only. No sentiment colour.
 *
 * A card, not a divided row: each rating is a thing an owner opens, and a
 * column of separate cards reads that way at a glance. Unread cards stand
 * forward (stronger edge, lifted) and carry the dot; sorted ones step back.
 * Nothing about a card depends on its star value.
 *
 * The cards rise in one after another as the list arrives, an unread dot
 * pings twice to say "new", and a card comes up to meet the pointer.
 */

export interface FeedbackItem {
  id: string;
  rating: number;
  note: string | null;
  submittedAt: string;
  isRead: boolean;
  isResolved: boolean;
  noteCount: number;
  /** Which Tag it came through — given only when the business has more than one. */
  tagLabel?: string | null;
}

export function FeedbackList({ items }: { items: FeedbackItem[] }) {
  return (
    <ul className="rb-stagger flex flex-col gap-2.5">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            href={`/feedback/${item.id}`}
            className={cn(
              "rb-lift group flex min-h-16 items-center gap-3 rounded-[var(--radius-card)] border bg-surface px-4 py-3.5",
              "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
              item.isRead
                ? "border-border shadow-[var(--shadow-card)] hover:border-[color:var(--rb-border-strong)]"
                : "border-[color:var(--rb-border-strong)] shadow-[var(--shadow-raised)]",
              item.isResolved && "bg-surface/70",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5">
                {/* Unread is a dot in its own slot, on the stars' line, so read
                    and unread cards keep their stars lined up down the list. */}
                <span className="flex w-2 shrink-0 justify-center" aria-hidden={item.isRead || undefined}>
                  {item.isRead ? null : (
                    <span className="rb-ping size-2 rounded-full bg-action" aria-label="Unread" role="img" />
                  )}
                </span>

                <Stars rating={item.rating} size="md" />

                {item.isResolved ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand-text">
                    <Check className="size-3" strokeWidth={3} aria-hidden="true" />
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

              {item.tagLabel ? (
                <p className="mt-1 truncate pl-[1.125rem] text-sm text-muted">{item.tagLabel}</p>
              ) : null}

              {/* A rating with no message is one line. Saying "Rating only,
                  no message" on every such card was the same sentence, over
                  and over, carrying nothing the stars had not already said. */}
              {item.note ? (
                <p
                  className={cn(
                    "mt-1.5 line-clamp-2 whitespace-pre-wrap pl-[1.125rem] text-base leading-relaxed",
                    item.isRead ? "text-muted" : "text-ink",
                  )}
                >
                  {item.note}
                </p>
              ) : null}

              {/* What the team wrote under "What we did": proof someone acted. */}
              {item.noteCount > 0 ? (
                <p className="mt-1.5 flex items-center gap-1.5 pl-[1.125rem] text-sm text-muted">
                  <MessageCircle className="size-3.5" aria-hidden="true" />
                  {item.noteCount === 1 ? "1 note" : `${item.noteCount} notes`}
                </p>
              ) : null}
            </div>

            <ChevronRight
              className="size-5 shrink-0 text-[color:var(--rb-border-strong)] transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
