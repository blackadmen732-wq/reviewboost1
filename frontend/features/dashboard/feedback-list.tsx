import { Check, ChevronRight, MessageCircle } from "lucide-react";
import Link from "next/link";

import { Stars } from "@/components/ui/stars";
import { relativeDay } from "@/lib/utils/relative-day";
import { cn } from "@/lib/utils/cn";

/**
 * The feedback inbox.
 *
 * A Server Component on purpose. Notes arrive already decrypted from the owner
 * data layer, which means the plaintext exists only in the HTML rendered for
 * this one signed-in owner. Shipping ciphertext to the browser and decrypting
 * there would mean shipping the key there too.
 *
 * Every row is a link now rather than a card with a button on it. The whole row
 * is the target — roughly a 90mm strip instead of a 40mm button — which matters
 * for someone tapping one-handed while holding a coffee pot.
 *
 * THREE STATES, SHOWN WITHOUT A LEGEND
 * ------------------------------------
 * Unread carries a filled dot and a heavier surface. Read but not sorted recedes
 * to a plain card. Sorted gets a tick and drops back further still.
 *
 * Read rows never disappear. An owner scanning the list should see what is new
 * without anything vanishing on them — a list that empties itself is a list
 * nobody trusts.
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
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            href={`/feedback/${item.id}`}
            className={cn(
              "flex items-start gap-3 rounded-[var(--radius-card)] border p-4",
              "transition-[border-color,transform] duration-150",
              "active:scale-[0.995] motion-reduce:active:scale-100",
              "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
              item.isResolved
                ? "border-border bg-surface/50"
                : item.isRead
                  ? "border-border bg-surface"
                  : "border-[color:var(--rb-border-strong)] bg-surface shadow-[var(--shadow-control)]",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex items-center gap-2">
                <Stars rating={item.rating} />

                {item.isRead ? null : (
                  <span className="size-2 rounded-full bg-brand" aria-label="Unread" role="img" />
                )}

                {item.isResolved ? (
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-brand-text">
                    <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
                    Sorted
                  </span>
                ) : null}

                <time
                  dateTime={item.submittedAt}
                  className="ml-auto shrink-0 text-sm text-muted"
                >
                  {relativeDay(item.submittedAt)}
                </time>
              </div>

              {item.note ? (
                // Clamped to two lines. The full text is one tap away, and a
                // 2,000-character rant would otherwise push every other item off
                // the screen.
                <p className="line-clamp-2 whitespace-pre-wrap text-base leading-relaxed text-ink">
                  {item.note}
                </p>
              ) : (
                <p className="text-base italic text-muted">Rating only, no message</p>
              )}

              {item.noteCount > 0 ? (
                <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-muted">
                  <MessageCircle className="size-3.5" aria-hidden="true" />
                  {item.noteCount === 1 ? "1 note" : `${item.noteCount} notes`}
                </p>
              ) : null}
            </div>

            <ChevronRight
              className="mt-0.5 size-5 shrink-0 text-[color:var(--rb-border-strong)]"
              aria-hidden="true"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
