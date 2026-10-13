import { ChevronRight } from "lucide-react";
import Link from "next/link";

import type { ConnectionCard, ConnectionState } from "@/lib/owner/connections";
import { cn } from "@/lib/utils/cn";

/**
 * The account cards under the app directory: the Google review link, billing,
 * texting and sign-in. Presentational: every value comes from
 * `deriveConnections`, which reads only real state.
 */
export function ConnectionsView({ cards }: { cards: readonly ConnectionCard[] }) {
  return (
    <>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-label="Your account">
        {cards.map((card) => (
          <li key={card.id}>
            <Connection card={card} />
          </li>
        ))}
      </ul>

    </>
  );
}

const PILL: Record<ConnectionState, string> = {
  connected: "bg-brand-soft text-brand-text",
  attention: "bg-[color:var(--rb-danger-soft)] text-danger",
  not_connected: "bg-quiet text-muted",
  test_mode: "bg-quiet text-ink",
  not_available: "bg-quiet text-muted",
};

function Connection({ card }: { card: ConnectionCard }) {
  return (
    <article
      className="flex h-full flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-5"
      data-connection={card.id}
      data-state={card.state}
    >
      <header className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{card.name}</h2>
        <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", PILL[card.state])}>
          {card.stateLabel}
        </span>
      </header>
      <p className="text-sm text-muted">{card.purpose}</p>
      {card.facts.length > 0 ? (
        <dl className="flex flex-col gap-1.5 text-sm">
          {card.facts.map((fact) => (
            <div key={`${fact.label}-${fact.value}`} className="flex flex-wrap gap-x-2">
              <dt className="text-muted">{fact.label}:</dt>
              <dd className="text-ink">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {card.action ? (
        <Link
          href={card.action.href}
          className="mt-auto inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium text-brand-text hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          {card.action.label}
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      ) : null}
    </article>
  );
}
