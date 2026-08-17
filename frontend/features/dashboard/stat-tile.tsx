import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * A number, a word, and somewhere to go.
 *
 * The number is enormous and the label is small, which is the opposite of most
 * dashboards and the right way round: the reader already knows what they came
 * to check, so the digit is the content and the word is only a confirmation.
 *
 * `needsAttention` turns the tile amber. That is the entire notification system
 * — no bell, no inbox, no badge nobody understands. Amber means *you*, grey
 * means nothing to do. An owner can learn that in one glance and never think
 * about it again.
 *
 * Colour is never the only signal: an amber tile also gets a filled icon
 * background and a stronger border, so it still reads as different in
 * greyscale or to a colourblind user.
 */

interface StatTileProps {
  value: number | string;
  label: string;
  icon: LucideIcon;
  href: string;
  needsAttention?: boolean;
}

export function StatTile({
  value,
  label,
  icon: Icon,
  href,
  needsAttention = false,
}: StatTileProps) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex min-h-[7.5rem] flex-col justify-between rounded-[var(--radius-card)] border p-4",
        "transition-[border-color,box-shadow,transform] duration-150",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
        "active:scale-[0.98] motion-reduce:active:scale-100",
        needsAttention
          ? "border-[color:var(--rb-star)] bg-[color:var(--rb-star)]/8 shadow-[var(--shadow-card)]"
          : "border-border bg-surface shadow-[var(--shadow-control)] hover:border-[color:var(--rb-border-strong)]",
      )}
    >
      <span
        className={cn(
          "grid size-10 place-items-center rounded-full",
          needsAttention ? "bg-[color:var(--rb-star)]/20" : "bg-quiet",
        )}
      >
        <Icon
          className={cn("size-5", needsAttention ? "text-[color:var(--rb-warning)]" : "text-muted")}
          aria-hidden="true"
        />
      </span>

      <span className="flex flex-col gap-0.5">
        {/* tabular-nums so the digit does not shift the layout as it changes. */}
        <span className="text-[2.25rem] font-semibold leading-none tabular-nums tracking-[-0.03em] text-ink">
          {value}
        </span>
        <span className="text-sm font-medium text-muted">{label}</span>
      </span>
    </Link>
  );
}
