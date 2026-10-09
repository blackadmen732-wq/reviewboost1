import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * The grouped inset list.
 *
 * One shape, used on every owner screen that is a list of settings, places or
 * destinations. A quiet caption names the group; the rows beneath it live in a
 * single card and are separated by hairlines rather than by gaps.
 *
 * WHY ONE CARD AND NOT MANY
 * -------------------------
 * A stack of separately bordered cards reads as a stack of unrelated things:
 * the eye counts six objects and has to work out what, if anything, binds them.
 * One card with hairlines reads as one object with six parts, and the caption
 * above it says what the parts have in common. That is the whole difference
 * between a settings screen that feels assembled and one that feels designed,
 * and it is the move every reference the owner chose makes.
 *
 * The customer page already works this way — one surface, hierarchy carried by
 * type and spacing instead of by borders. This brings the owner side to the
 * same language.
 */

/** Deterministic id for the caption, so the section can label itself without a
 *  client-side hook. Server components cannot call useId. */
function slugOf(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function SettingGroup({
  label,
  description,
  children,
  className,
}: {
  /** The quiet caption above the card. Sentence case: it is a label, not a shout. */
  label?: string | undefined;
  /** Rare. Use when the group needs a sentence the rows cannot carry themselves. */
  description?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  const headingId = label ? `group-${slugOf(label)}` : undefined;

  return (
    <section
      className={cn("mb-7", className)}
      {...(headingId ? { "aria-labelledby": headingId } : {})}
    >
      {label ? (
        <h2
          id={headingId}
          className="mb-2 px-1 text-[length:var(--rb-text-small)] font-medium text-muted"
        >
          {label}
        </h2>
      ) : null}

      {description ? (
        <p className="mb-3 px-1 text-[length:var(--rb-text-small)] leading-relaxed text-muted">
          {description}
        </p>
      ) : null}

      {/* overflow-hidden so the first and last rows take the card's corners —
          without it a hover or focus background squares them off. */}
      <div className="divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        {children}
      </div>
    </section>
  );
}

/**
 * The chrome a row draws for itself.
 *
 * Inside a `SettingGroup` the card already supplies the border, the rounding
 * and the background, so an inset row draws only its padding. Without this a
 * component that renders its own card ends up as a card inside a card, which
 * is the exact look this system exists to remove.
 *
 * `accent` is the mid-edit state. Standalone it reads as a brand border;
 * inset it becomes an inset ring over a quiet fill, because a border inside a
 * divided card fights the hairlines on either side of it.
 */
export function settingSurface({
  inset = false,
  accent = false,
}: { inset?: boolean | undefined; accent?: boolean | undefined } = {}): string {
  if (inset) {
    return cn("p-4", accent && "bg-quiet ring-1 ring-inset ring-brand");
  }
  return cn(
    "rounded-[var(--radius-card)] border bg-surface p-4",
    accent ? "border-brand" : "border-border",
  );
}

type RowBase = {
  /** Outline icon, drawn bare. No circular chip: the chip was decoration that
   *  made every row look like a button and cost 40px of width. */
  icon?: LucideIcon | undefined;
  title: string;
  /** The quiet second line. Optional — a row that explains itself does not need one. */
  description?: string | undefined;
  /** Right-aligned current value, as in `Theme  Light ›`. Tells someone what a
   *  door leads to before they open it. */
  value?: string | undefined;
  /** A control that lives in the row itself (a switch, a segmented choice).
   *  Mutually exclusive with `value` in practice. */
  trailing?: ReactNode | undefined;
  /** Danger rows tint the title only. The row keeps its place in the list;
   *  colouring the whole surface red turns a setting into an alarm. */
  tone?: "default" | "danger" | undefined;
  className?: string | undefined;
};

const ROW_SHELL =
  "flex w-full min-h-[var(--rb-row)] items-center gap-4 px-4 py-3.5 text-left";

const ROW_INTERACTIVE =
  "transition-colors duration-150 hover:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)] focus-visible:ring-inset";

function RowBody({
  icon: Icon,
  title,
  description,
  value,
  trailing,
  tone = "default",
  chevron,
}: RowBase & { chevron: boolean }) {
  return (
    <>
      {Icon ? (
        <Icon
          className={cn("size-5 shrink-0", tone === "danger" ? "text-danger" : "text-muted")}
          aria-hidden="true"
        />
      ) : null}

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-[length:var(--rb-text-body)] font-medium",
            tone === "danger" ? "text-danger" : "text-ink",
          )}
        >
          {title}
        </span>
        {description ? (
          <span className="mt-0.5 block text-[length:var(--rb-text-small)] leading-snug text-muted">
            {description}
          </span>
        ) : null}
      </span>

      {value ? (
        <span className="shrink-0 text-[length:var(--rb-text-small)] text-muted">{value}</span>
      ) : null}

      {trailing ? <span className="shrink-0">{trailing}</span> : null}

      {chevron ? (
        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden="true" />
      ) : null}
    </>
  );
}

/**
 * One row.
 *
 * `href` makes it a link, `onClick` a button, neither a plain readout. A row
 * that goes somewhere always shows the chevron: the affordance is what turns a
 * line of text into something a thumb knows it can press.
 */
export function SettingRow({
  href,
  external,
  onClick,
  disabled,
  className,
  ...body
}: RowBase & {
  href?: string | undefined;
  /** mailto:, tel: and off-site links render as a plain anchor, not a Link. */
  external?: boolean | undefined;
  onClick?: (() => void) | undefined;
  disabled?: boolean | undefined;
}) {
  if (href) {
    const classes = cn(ROW_SHELL, ROW_INTERACTIVE, className);
    const content = <RowBody {...body} chevron />;

    return external || href.startsWith("mailto:") || href.startsWith("tel:") ? (
      <a href={href} className={classes}>
        {content}
      </a>
    ) : (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(ROW_SHELL, ROW_INTERACTIVE, "disabled:opacity-60", className)}
      >
        <RowBody {...body} chevron={false} />
      </button>
    );
  }

  return (
    <div className={cn(ROW_SHELL, className)}>
      <RowBody {...body} chevron={false} />
    </div>
  );
}
