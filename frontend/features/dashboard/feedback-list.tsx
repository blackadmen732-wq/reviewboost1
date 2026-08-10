import { Star } from "lucide-react";

import { tryDecrypt } from "@/lib/server/crypto";
import { cn } from "@/lib/utils/cn";

/**
 * The feedback list.
 *
 * A Server Component on purpose: notes are encrypted at rest, and decrypting
 * them here means the plaintext exists only in the rendered HTML for this one
 * signed-in owner. Shipping ciphertext to the browser and decrypting there
 * would mean shipping the key there too.
 *
 * Unread rows carry a filled dot and a heavier surface. Read rows recede rather
 * than disappearing — an owner scanning the list should be able to tell at a
 * glance what is new without anything vanishing on them.
 */

export interface FeedbackItem {
  id: string;
  rating: number;
  noteEncrypted: string | null;
  submittedAt: string;
  isRead: boolean;
}

export function FeedbackList({ items }: { items: FeedbackItem[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => {
        const note = tryDecrypt(item.noteEncrypted);

        return (
          <li
            key={item.id}
            className={cn(
              "rounded-[var(--radius-card)] border p-4",
              item.isRead
                ? "border-border bg-surface/60"
                : "border-[color:var(--rb-border-strong)] bg-surface shadow-[var(--shadow-control)]",
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <Stars rating={item.rating} />
              <div className="flex items-center gap-2">
                <time
                  dateTime={item.submittedAt}
                  className="text-sm text-muted"
                  suppressHydrationWarning
                >
                  {relativeDay(item.submittedAt)}
                </time>
                {item.isRead ? null : (
                  <span
                    className="size-2 rounded-full bg-brand"
                    aria-label="Unread"
                    role="img"
                  />
                )}
              </div>
            </div>

            {note ? (
              <p className="whitespace-pre-wrap text-base leading-relaxed text-ink">{note}</p>
            ) : (
              // Most customers rate and leave. Saying so is kinder than an
              // empty space that looks like something failed to load.
              <p className="text-base italic text-muted">Rating only, no message</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5" role="img" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((position) => (
        <Star
          key={position}
          className={cn(
            "size-4",
            position <= rating
              ? "fill-[color:var(--rb-star)] text-[color:var(--rb-star)]"
              : "text-[color:var(--rb-border-strong)]",
          )}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

/**
 * "Today" beats a date nobody has to decode.
 *
 * Anything older than a week gets a real date, because "23 days ago" is harder
 * to place than "12 Jul".
 */
function relativeDay(iso: string): string {
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);

  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;

  return then.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
