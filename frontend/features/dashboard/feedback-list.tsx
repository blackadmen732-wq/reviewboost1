import { Stars } from "@/components/ui/stars";
import { MarkReadButton } from "@/features/dashboard/mark-read-button";
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
 * Unread rows carry a filled dot and a heavier surface. Read rows recede rather
 * than disappearing — an owner scanning the list should be able to tell at a
 * glance what is new without anything vanishing on them.
 */

export interface FeedbackItem {
  id: string;
  rating: number;
  note: string | null;
  submittedAt: string;
  isRead: boolean;
}

export function FeedbackList({ items }: { items: FeedbackItem[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
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
              <time dateTime={item.submittedAt} className="text-sm text-muted">
                {relativeDay(item.submittedAt)}
              </time>
              {item.isRead ? null : (
                <span className="size-2 rounded-full bg-brand" aria-label="Unread" role="img" />
              )}
            </div>
          </div>

          {item.note ? (
            <p className="whitespace-pre-wrap text-base leading-relaxed text-ink">{item.note}</p>
          ) : (
            // Most customers rate and leave. Saying so is kinder than an empty
            // space that looks like something failed to load.
            <p className="text-base italic text-muted">Rating only, no message</p>
          )}

          {item.isRead ? null : (
            <div className="mt-3 flex justify-end">
              <MarkReadButton responseId={item.id} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
